import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// DELETE /api/admin/surveys/forms/[id] — remove a form. Cascades its composed questions, recipients
// and answers (FKs are ON DELETE CASCADE). We ALSO delete this form's (mumin, question) exposures
// first, so deleting a form fully reverses it and those questions become askable again — otherwise
// the once-per-event exposure rows would linger (form_id set null) and silently block re-asking.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: form } = await supabase.from("survey_forms").select("id").eq("id", id).maybeSingle();
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });

  await supabase.from("survey_question_exposures").delete().eq("form_id", id);
  const { error } = await supabase.from("survey_forms").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ status: "deleted" });
}
