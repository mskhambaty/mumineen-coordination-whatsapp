import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Edit / remove a single composed question on a form (its snapshot). Edits apply ONLY to this form —
// the databank question is untouched. Blocked once the form is sent (answers are already in).
const patchSchema = z.object({
  text: z.string().min(3).max(500).optional(),
  options: z.array(z.object({ label: z.string().min(1), score: z.number().int().min(1).max(5).optional() })).nullable().optional(),
  negative_values: z.array(z.string()).nullable().optional(),
  polarity: z.enum(["positive", "negative"]).optional(),
  comment_threshold: z.number().int().min(1).max(10).nullable().optional(),
  collect_comment: z.boolean().optional(),
  required: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, "No fields to update.");

async function ensureEditable(supabase: ReturnType<typeof getSupabaseAdmin>, formId: string) {
  const { data: form } = await supabase.from("survey_forms").select("status").eq("id", formId).maybeSingle();
  if (!form) return { error: "Form not found.", status: 404 as const };
  if ((form as { status: string }).status === "sent") return { error: "This form has been sent — its questions are locked.", status: 400 as const };
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; fqId: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id, fqId } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.options !== undefined && parsed.data.options && parsed.data.options.length < 2) {
    return NextResponse.json({ error: "Choice questions need at least 2 options." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const lock = await ensureEditable(supabase, id);
  if (lock) return NextResponse.json({ error: lock.error }, { status: lock.status });

  const { data: row } = await supabase.from("survey_form_questions").select("snapshot").eq("id", fqId).eq("form_id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Question not found on this form." }, { status: 404 });

  // Merge the patch into the existing snapshot (snapshot is the form's own copy of the question).
  const snapshot = { ...((row as { snapshot: Record<string, unknown> }).snapshot ?? {}), ...parsed.data };
  const { error } = await supabase.from("survey_form_questions").update({ snapshot }).eq("id", fqId).eq("form_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshot });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; fqId: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id, fqId } = await params;

  const supabase = getSupabaseAdmin();
  const lock = await ensureEditable(supabase, id);
  if (lock) return NextResponse.json({ error: lock.error }, { status: lock.status });

  const { error } = await supabase.from("survey_form_questions").delete().eq("id", fqId).eq("form_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
