import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// PATCH /api/admin/surveys/questions/[id] — edit a databank question. Edits only affect FUTURE
// forms; existing forms snapshot the question text, so already-sent surveys are unchanged.
const patchSchema = z
  .object({
    text: z.string().min(3).max(500).optional(),
    type: z.enum(["choice", "scale10", "scale5", "yesno", "text"]).optional(),
    options: z.array(z.object({ label: z.string().min(1), score: z.number().int().min(1).max(5).optional() })).nullable().optional(),
    negative_values: z.array(z.string()).nullable().optional(),
    polarity: z.enum(["positive", "negative"]).optional(),
    is_general: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "No fields to update.");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;
  if (b.type === "choice" && b.options !== undefined && (!b.options || b.options.length < 2)) {
    return NextResponse.json({ error: "Choice questions need at least 2 options." }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["text", "type", "options", "negative_values", "polarity", "is_general"] as const) {
    if (b[k] !== undefined) update[k] = b[k];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("survey_questions")
    .update(update)
    .eq("id", id)
    .select("id, section_id, text, type, options, negative_values, polarity, is_general, sort_order, active")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Question not found." }, { status: 404 });
  return NextResponse.json({ question: data });
}

// DELETE /api/admin/surveys/questions/[id] — retire a databank question (soft-delete via
// active=false). It disappears from the databank and the compose picker, but existing forms keep
// working (they snapshot question text) and past answers/exposures stay intact for the record.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("survey_questions")
    .update({ active: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Question not found." }, { status: 404 });
  return NextResponse.json({ status: "retired" });
}
