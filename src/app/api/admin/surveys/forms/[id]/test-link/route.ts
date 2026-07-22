import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { generateSurveyToken, chicagoToday } from "@/lib/surveys/tokens";
import { surveyLink, deliverSurveyLink } from "@/lib/surveys/send";

export const runtime = "nodejs";

// POST /api/admin/surveys/forms/[id]/test-link — mint a throwaway tokenized link for the admin to
// preview/test the real form flow (open + submit). The recipient is flagged is_test=true, writes NO
// question exposures, and is excluded from results, so it never pollutes sampling or analytics.
//   { its }          — target a specific person (form greets them by name; response attributable).
//   { its, deliver } — also send the link to THAT person's WhatsApp (when SURVEY_SEND_ENABLED).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: form } = await supabase.from("survey_forms").select("id, group_id, template_phrase").eq("id", id).maybeSingle();
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });

  const { count } = await supabase.from("survey_form_questions").select("id", { count: "exact", head: true }).eq("form_id", id);
  if (!count) return NextResponse.json({ error: "Compose questions for this form first." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { its?: unknown; deliver?: unknown; template?: unknown };
  let muminId: string | null = null;
  let familyId: string | null = null;
  let name: string | null = null;
  let phone: string | null = null;
  const its = typeof body.its === "string" ? body.its.trim() : "";
  if (its) {
    const { data: mumin } = await supabase
      .from("mumineen")
      .select("id, family_id, full_name, whatsapp_e164")
      .eq("its", its)
      .eq("roster_active", true)
      .maybeSingle();
    if (!mumin) return NextResponse.json({ error: `ITS ${its} not found in the active roster.` }, { status: 400 });
    const m = mumin as { id: string; family_id: string | null; full_name: string | null; whatsapp_e164: string | null };
    muminId = m.id;
    familyId = m.family_id;
    name = m.full_name;
    phone = m.whatsapp_e164;
  }

  const token = generateSurveyToken();
  const { error } = await supabase.from("survey_recipients").insert({
    form_id: id,
    mumin_id: muminId,
    family_id: familyId,
    phone_e164: phone,
    group_id: (form as { group_id: string | null }).group_id,
    token,
    status: "sampled",
    is_test: true,
    event_date: chicagoToday(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optionally deliver the test to that person's WhatsApp (gated by SURVEY_SEND_ENABLED + template).
  let delivery: { delivered: boolean; error?: string } | null = null;
  if (body.deliver === true) {
    if (!phone) delivery = { delivered: false, error: "That person has no WhatsApp number on file." };
    else delivery = await deliverSurveyLink(phone, token, name, typeof body.template === "string" ? body.template : undefined, (form as { template_phrase: string | null }).template_phrase);
  }

  return NextResponse.json({ link: surveyLink(token), token, name, phone, delivery });
}
