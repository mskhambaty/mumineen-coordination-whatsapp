import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/surveys/questions — add a question to a section (databank grows as the event
// progresses). New questions are eligible for future forms and start with zero exposures.
const bodySchema = z.object({
  section_id: z.string().uuid(),
  text: z.string().min(3).max(500),
  type: z.enum(["choice", "scale10", "scale5", "yesno", "text"]),
  options: z.array(z.object({ label: z.string().min(1), score: z.number().int().min(1).max(5).optional() })).optional(),
  negative_values: z.array(z.string()).optional(),
  polarity: z.enum(["positive", "negative"]).optional(),
  is_general: z.boolean().optional(),
  collect_comment: z.boolean().optional(),
  comment_threshold: z.number().int().min(1).max(10).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;
  if (b.type === "choice" && (!b.options || b.options.length < 2)) {
    return NextResponse.json({ error: "Choice questions need at least 2 options." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: maxRow } = await supabase
    .from("survey_questions")
    .select("sort_order")
    .eq("section_id", b.section_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((maxRow as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("survey_questions")
    .insert({
      section_id: b.section_id,
      text: b.text,
      type: b.type,
      options: b.options ?? null,
      negative_values: b.negative_values ?? (b.type === "yesno" ? ["No"] : null),
      polarity: b.polarity ?? "positive",
      is_general: b.is_general ?? false,
      collect_comment: b.collect_comment ?? true,
      comment_threshold: b.comment_threshold ?? null,
      sort_order: sortOrder,
    })
    .select("id, section_id, text, type, options, negative_values, polarity, is_general, collect_comment, comment_threshold, sort_order, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ question: data }, { status: 201 });
}
