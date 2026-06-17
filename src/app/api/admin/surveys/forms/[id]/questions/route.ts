import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/surveys/forms/[id]/questions — the form's composed questions (snapshots), in order.
// Powers the "Questions" panel where an admin reviews and edits a form's questions on the fly.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [{ data: form }, { data: fqs }] = await Promise.all([
    supabase.from("survey_forms").select("id, title, status").eq("id", id).maybeSingle(),
    supabase.from("survey_form_questions").select("id, question_id, section_id, area, snapshot, sort_order").eq("form_id", id).order("sort_order"),
  ]);
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });

  return NextResponse.json({ form, questions: fqs ?? [] });
}
