import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// PATCH /api/admin/surveys/forms/[id] — edit a form's editable fields (currently sample_size, the
// number of mumineen the next commit/send will sample). Doesn't touch already-committed recipients.
const patchSchema = z.object({
  sample_size: z.number().int().min(1).max(2000).optional(),
  title: z.string().min(3).max(200).optional(),
  tags: z.array(z.string().min(1).max(40)).max(12).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  if (Object.keys(parsed.data).length === 0) return NextResponse.json({ error: "No changes." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("survey_forms")
    .update(parsed.data)
    .eq("id", id)
    .select("id, title, sample_size, status, tags")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Form not found." }, { status: 404 });
  return NextResponse.json({ form: data });
}

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
