import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { chicagoToday } from "@/lib/surveys/tokens";
import { validateRules, type RuleGroup } from "@/lib/whatsapp/audience-filter";

export const runtime = "nodejs";

// GET — list forms (newest first) with recipient/response counts.
export async function GET(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const supabase = getSupabaseAdmin();

  const { data: forms } = await supabase
    .from("survey_forms")
    .select("id, title, public_title, group_id, rules, sample_plan, tags, sample_size, event_date, status, created_at, sent_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const formRows = (forms ?? []) as { id: string; group_id: string | null; rules: unknown; sample_plan: { label: string; size: number }[] | null; tags: string[] | null }[];

  const { data: groups } = await supabase.from("survey_groups").select("id, name");
  // Paginate — a single read caps at 1000 rows and would undercount recipients once the table grows.
  const recips: { form_id: string; status: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("survey_recipients").select("form_id, status").range(from, from + 999);
    if (error) break;
    recips.push(...((data ?? []) as typeof recips));
    if (!data || data.length < 1000) break;
  }
  const groupName = new Map(((groups ?? []) as { id: string; name: string }[]).map((g) => [g.id, g.name]));
  const counts = new Map<string, { sent: number; completed: number }>();
  for (const r of recips) {
    const c = counts.get(r.form_id) ?? { sent: 0, completed: 0 };
    c.sent += 1;
    if (r.status === "completed") c.completed += 1;
    counts.set(r.form_id, c);
  }

  return NextResponse.json({
    forms: formRows.map((f) => ({
      ...f,
      tags: f.tags ?? [],
      group_name: f.sample_plan?.length
        ? `Stratified: ${f.sample_plan.map((s) => `${s.label} ${s.size}`).join(" + ")}`
        : f.group_id ? groupName.get(f.group_id) ?? null : f.rules ? "Custom filter" : null,
      recipient_count: counts.get(f.id)?.sent ?? 0,
      completed_count: counts.get(f.id)?.completed ?? 0,
    })),
  });
}

// POST — create a form and compose its questions (snapshotting text/type/options for stability).
// Target is EITHER a saved group (group_id) OR an ad-hoc custom audience filter (rules) — the latter
// lets the admin carve out exclusions (e.g. attending AND NOT rahat) so a broad form doesn't re-hit
// people already covered by a narrower one.
const ruleGroupSchema = z.object({ combinator: z.string().optional(), rules: z.array(z.unknown()) }).passthrough();
const bodySchema = z
  .object({
    title: z.string().min(2).max(160),
    public_title: z.string().min(2).max(160).optional(),
    group_id: z.string().uuid().optional(),
    rules: ruleGroupSchema.optional(),
    // Stratified target: each stratum its own filter + quota (e.g. Local 107, Mehman 70).
    sample_plan: z.array(z.object({ label: z.string().min(1).max(40), rules: ruleGroupSchema, size: z.number().int().min(1).max(2000) })).min(1).max(10).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
    sample_size: z.number().int().min(1).max(2000).optional(),
    question_ids: z.array(z.string().uuid()).min(1).max(200),
  })
  .refine((b) => [b.group_id, b.rules, b.sample_plan].filter(Boolean).length === 1, "Provide exactly one target: group_id, rules, or sample_plan.");

export async function POST(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;
  // Validate any custom filter / stratum rules against the field catalog before storing.
  if (b.rules) {
    const err = validateRules(b.rules as unknown as RuleGroup);
    if (err) return NextResponse.json({ error: `Invalid filter: ${err}` }, { status: 400 });
  }
  if (b.sample_plan) {
    for (const s of b.sample_plan) {
      const err = validateRules(s.rules as unknown as RuleGroup);
      if (err) return NextResponse.json({ error: `Invalid filter in stratum "${s.label}": ${err}` }, { status: 400 });
    }
  }
  const supabase = getSupabaseAdmin();

  // Load chosen questions + their sections to snapshot.
  const { data: questions } = await supabase
    .from("survey_questions")
    .select("id, section_id, text, type, options, negative_values, polarity, comment_threshold, collect_comment, required")
    .in("id", b.question_ids);
  const qs = (questions ?? []) as Array<{ id: string; section_id: string; text: string; type: string; options: unknown; negative_values: unknown; polarity: string; comment_threshold: number | null; collect_comment: boolean; required: boolean }>;
  if (qs.length === 0) return NextResponse.json({ error: "No valid questions." }, { status: 400 });

  const sectionIds = Array.from(new Set(qs.map((q) => q.section_id)));
  const { data: sections } = await supabase.from("survey_sections").select("id, title, area, sort_order").in("id", sectionIds);
  const secById = new Map(((sections ?? []) as { id: string; title: string; area: string; sort_order: number }[]).map((s) => [s.id, s]));

  const { data: form, error } = await supabase
    .from("survey_forms")
    .insert({
      title: b.title,
      public_title: b.public_title ?? null,
      group_id: b.group_id ?? null,
      rules: b.rules ?? null,
      sample_plan: b.sample_plan ?? null,
      tags: b.tags ?? [],
      sample_size: b.sample_size ?? 40,
      event_date: chicagoToday(),
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !form) return NextResponse.json({ error: error?.message ?? "Failed to create form" }, { status: 500 });

  // Preserve the chosen order; group by section sort_order then question order within the request.
  const orderOfQ = new Map(b.question_ids.map((id, i) => [id, i]));
  const composed = qs
    .map((q) => {
      const sec = secById.get(q.section_id);
      return {
        form_id: form.id,
        section_id: q.section_id,
        question_id: q.id,
        area: sec?.area ?? "general",
        snapshot: {
          text: q.text,
          type: q.type,
          options: q.options,
          negative_values: q.negative_values,
          polarity: q.polarity,
          comment_threshold: q.comment_threshold,
          collect_comment: q.collect_comment,
          required: q.required,
          section_title: sec?.title ?? "Feedback",
        },
        sort_order: (sec?.sort_order ?? 0) * 1000 + (orderOfQ.get(q.id) ?? 0),
      };
    })
    .sort((a, c) => a.sort_order - c.sort_order);

  const { error: cErr } = await supabase.from("survey_form_questions").insert(composed);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  return NextResponse.json({ form_id: form.id, question_count: composed.length }, { status: 201 });
}
