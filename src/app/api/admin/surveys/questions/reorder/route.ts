import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/surveys/questions/reorder — set the display order of questions within a section.
// Body { section_id, ordered_ids: [...] } rewrites each question's sort_order to its position.
// Order is cosmetic (databank + compose listing); it never touches already-composed form snapshots.
const bodySchema = z.object({
  section_id: z.string().uuid(),
  ordered_ids: z.array(z.string().uuid()).min(1),
});

export async function POST(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  const { section_id, ordered_ids } = parsed.data;

  const supabase = getSupabaseAdmin();
  // Guard: every id must be an active question in this section (no cross-section moves).
  const { data: rows } = await supabase
    .from("survey_questions")
    .select("id")
    .eq("section_id", section_id)
    .eq("active", true);
  const valid = new Set(((rows ?? []) as { id: string }[]).map((r) => r.id));
  if (ordered_ids.some((id) => !valid.has(id))) {
    return NextResponse.json({ error: "ordered_ids must all be active questions in this section." }, { status: 400 });
  }

  // Rewrite sort_order to position (×10 to leave gaps for future single-row inserts).
  const results = await Promise.all(
    ordered_ids.map((id, i) =>
      supabase.from("survey_questions").update({ sort_order: (i + 1) * 10 }).eq("id", id).eq("section_id", section_id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
