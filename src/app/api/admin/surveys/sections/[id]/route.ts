import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { FEEDBACK_AREAS } from "@/lib/feedback/areas";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// PATCH /api/admin/surveys/sections/[id] — edit a section's name / area / is_general.
const patchSchema = z.object({
  title: z.string().min(3).max(120).optional(),
  area: z.enum(FEEDBACK_AREAS).optional(),
  description: z.string().max(500).nullable().optional(),
  is_general: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "No changes." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("survey_sections")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, key, title, description, area, is_general, sort_order, active")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Section not found." }, { status: 404 });
  return NextResponse.json({ section: data });
}

// DELETE /api/admin/surveys/sections/[id] — soft-delete (active=false) the section and its
// questions so they drop out of the databank and future forms. Already-composed forms keep working
// because they snapshot the question text/options at compose time.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("survey_sections")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Section not found." }, { status: 404 });
  await supabase.from("survey_questions").update({ active: false }).eq("section_id", id);
  return NextResponse.json({ ok: true });
}
