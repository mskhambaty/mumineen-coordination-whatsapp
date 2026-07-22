import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { chicagoToday } from "@/lib/surveys/tokens";

export const runtime = "nodejs";

// POST /api/admin/surveys/forms/[id]/clone — exact clone of a form into a fresh DRAFT for today,
// carrying title/public_title/tags/target (group_id | rules | sample_plan)/sample_size AND the
// composed question snapshots. Used to re-run a daily form: Commit & send on the clone samples a
// fresh, unique set (yesterday's recipients are excluded as exhausted / already-surveyed).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: src } = await supabase
    .from("survey_forms")
    .select("title, public_title, tags, group_id, rules, sample_plan, resend_until_responded, sample_size")
    .eq("id", id)
    .maybeSingle();
  if (!src) return NextResponse.json({ error: "Form not found." }, { status: 404 });

  const { data: nf, error } = await supabase
    .from("survey_forms")
    .insert({ ...(src as Record<string, unknown>), status: "draft", event_date: chicagoToday(), sent_at: null })
    .select("id")
    .single();
  if (error || !nf) return NextResponse.json({ error: error?.message ?? "Failed to clone form." }, { status: 500 });

  // Copy the composed question snapshots verbatim (preserves any per-form edits).
  const { data: fqs } = await supabase
    .from("survey_form_questions")
    .select("section_id, question_id, area, snapshot, sort_order")
    .eq("form_id", id);
  const rows = ((fqs ?? []) as Record<string, unknown>[]).map((q) => ({ ...q, form_id: (nf as { id: string }).id }));
  if (rows.length) {
    const { error: cErr } = await supabase.from("survey_form_questions").insert(rows);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  return NextResponse.json({ form_id: (nf as { id: string }).id, questions: rows.length });
}
