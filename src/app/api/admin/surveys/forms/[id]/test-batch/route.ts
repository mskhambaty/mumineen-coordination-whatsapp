import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { generateSurveyToken, chicagoToday } from "@/lib/surveys/tokens";
import { surveyLink, deliverSurveyLink } from "@/lib/surveys/send";

export const runtime = "nodejs";

// POST /api/admin/surveys/forms/[id]/test-batch — manually-selected recipients. For each ITS: create
// a recipient and return its personalized link; with deliver:true also send it to that person's
// WhatsApp. Two modes:
//  - default (real:false) → is_test recipient: in-team testing, no exposures, EXCLUDED from results.
//  - real:true → a genuine, attributed recipient COUNTED in analytics. This is the "send manually,
//    individually" path for forms with no roster-derived audience (e.g. the special-care seating
//    feedback): the admin identifies each family by hand and mints a real, tracked link per person.
const bodySchema = z.object({
  its: z.array(z.string().min(1)).min(1).max(100),
  deliver: z.boolean().optional(),
  real: z.boolean().optional(),
  template: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });

  const { data: form } = await supabase.from("survey_forms").select("id, group_id").eq("id", id).maybeSingle();
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });
  const { count } = await supabase.from("survey_form_questions").select("id", { count: "exact", head: true }).eq("form_id", id);
  if (!count) return NextResponse.json({ error: "Compose questions for this form first." }, { status: 400 });

  const itsList = Array.from(new Set(parsed.data.its.map((s) => s.trim()).filter(Boolean)));
  const { data: mumineen } = await supabase
    .from("mumineen")
    .select("id, its, family_id, full_name, whatsapp_e164")
    .in("its", itsList)
    .eq("roster_active", true);
  const byIts = new Map(((mumineen ?? []) as { id: string; its: string; family_id: string | null; full_name: string | null; whatsapp_e164: string | null }[]).map((m) => [m.its, m]));

  const results: Array<{ its: string; name: string | null; phone: string | null; link?: string; delivered?: boolean; error?: string }> = [];
  for (const its of itsList) {
    const m = byIts.get(its);
    if (!m) { results.push({ its, name: null, phone: null, error: "Not in active roster" }); continue; }
    const token = generateSurveyToken();
    const { error } = await supabase.from("survey_recipients").insert({
      form_id: id, mumin_id: m.id, family_id: m.family_id, phone_e164: m.whatsapp_e164,
      group_id: (form as { group_id: string | null }).group_id, token, status: "sampled",
      is_test: !parsed.data.real, event_date: chicagoToday(),
    });
    if (error) { results.push({ its, name: m.full_name, phone: m.whatsapp_e164, error: error.message }); continue; }
    const row: { its: string; name: string | null; phone: string | null; link?: string; delivered?: boolean; error?: string } = {
      its, name: m.full_name, phone: m.whatsapp_e164, link: surveyLink(token),
    };
    if (parsed.data.deliver) {
      if (!m.whatsapp_e164) row.error = "No WhatsApp number on file.";
      else { const d = await deliverSurveyLink(m.whatsapp_e164, token, m.full_name, parsed.data.template); row.delivered = d.delivered; if (d.error) row.error = d.error; }
    }
    results.push(row);
  }

  return NextResponse.json({ recipients: results });
}
