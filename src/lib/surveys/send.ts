import { getSupabaseAdmin } from "@/lib/supabase/server";
import { createBroadcast } from "@/lib/whatsapp/broadcast";
import type { Recipient } from "@/lib/whatsapp/audience";
import type { RuleGroup } from "@/lib/whatsapp/audience-filter";
import { suggestSample, type SampleResult } from "@/lib/surveys/sampling";
import { generateSurveyToken, chicagoToday } from "@/lib/surveys/tokens";

// Commit a form's sample and (optionally) dispatch the WhatsApp template.
//
// "Commit" is the irreversible step: it creates per-recipient tokens and writes the
// (mumin, question) exposures that enforce once-per-event no-repeat. WhatsApp dispatch is gated
// by SURVEY_SEND_ENABLED + SURVEY_WA_TEMPLATE so the build never blocks on Meta template approval;
// until then the returned links can be exported and sent another way.

export function surveyBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function surveyLink(token: string): string {
  return `${surveyBaseUrl()}/feedback/s/${token}`;
}

// Send a single survey link to one phone via the WhatsApp template (used for "send a test to a
// specific person"). Gated by SURVEY_SEND_ENABLED + SURVEY_WA_TEMPLATE; queues via the broadcast
// engine (the drain cron delivers). Returns delivered=true when queued.
export async function deliverSurveyLink(phone: string, token: string, name: string | null): Promise<{ delivered: boolean; error?: string }> {
  const sendEnabled = process.env.SURVEY_SEND_ENABLED === "true";
  const templateCode = process.env.SURVEY_WA_TEMPLATE;
  if (!sendEnabled || !templateCode) {
    return { delivered: false, error: "WhatsApp sending is off (set SURVEY_SEND_ENABLED + SURVEY_WA_TEMPLATE). Copy the link and send it manually." };
  }
  const result = await createBroadcast({
    templateCode,
    recipients: [{ phone, familyId: null, muminId: null, fields: { survey_token: token, first_name: (name ?? "").split(" ")[0] || "Mumin" } }],
    audienceKey: "custom",
    variableBindings: { urlButton: { kind: "field", field: "survey_token" }, body: { "1": { kind: "field", field: "first_name" } } },
  });
  if ("error" in result) return { delivered: false, error: result.error };
  return { delivered: true };
}

export type CommittedRecipient = { recipientId: string; muminId: string; phone: string; name: string | null; token: string; link: string };
export type CommitResult = {
  formId: string;
  funnel: SampleResult["funnel"];
  recipients: CommittedRecipient[];
  sent: boolean;
  sendError?: string;
};

type FormRow = { id: string; group_id: string | null; sample_size: number; status: string };

export async function commitAndSendForm(formId: string): Promise<CommitResult | { error: string }> {
  const supabase = getSupabaseAdmin();
  const eventDate = chicagoToday();

  const { data: form } = await supabase
    .from("survey_forms")
    .select("id, group_id, sample_size, status")
    .eq("id", formId)
    .maybeSingle();
  if (!form) return { error: "Form not found." };
  const f = form as FormRow;
  if (f.status === "sent") return { error: "This form has already been sent." };
  if (!f.group_id) return { error: "Form has no target group." };

  const { data: group } = await supabase
    .from("survey_groups")
    .select("id, rules")
    .eq("id", f.group_id)
    .maybeSingle();
  if (!group) return { error: "Target group not found." };

  const { data: fqs } = await supabase
    .from("survey_form_questions")
    .select("question_id")
    .eq("form_id", formId);
  const questionIds = ((fqs ?? []) as { question_id: string | null }[])
    .map((q) => q.question_id)
    .filter((id): id is string => Boolean(id));
  if (questionIds.length === 0) return { error: "Form has no questions composed." };

  // Sample fresh-first, excluding today's other samples and question-exhausted mumineen.
  const sample = await suggestSample((group as { rules: RuleGroup }).rules, questionIds, f.sample_size, eventDate);
  if (sample.chosen.length === 0) {
    return { formId, funnel: sample.funnel, recipients: [], sent: false, sendError: "No eligible recipients to sample." };
  }

  // Create recipient rows with unique tokens.
  const recipientRows = sample.chosen.map((c) => ({
    form_id: formId,
    mumin_id: c.muminId,
    family_id: c.familyId,
    phone_e164: c.phone,
    group_id: f.group_id,
    token: generateSurveyToken(),
    status: "sampled" as const,
    event_date: eventDate,
  }));
  const { data: inserted, error: insErr } = await supabase
    .from("survey_recipients")
    .insert(recipientRows)
    .select("id, mumin_id, phone_e164, token");
  if (insErr || !inserted) return { error: insErr?.message ?? "Failed to create recipients." };

  // Record (mumin, question) exposures — once-per-event no-repeat. Ignore duplicates.
  const exposureRows = sample.chosen.flatMap((c) =>
    questionIds.map((qid) => ({ mumin_id: c.muminId, question_id: qid, form_id: formId, event_date: eventDate })),
  );
  await supabase
    .from("survey_question_exposures")
    .upsert(exposureRows, { onConflict: "mumin_id,question_id", ignoreDuplicates: true });

  const nameByMumin = new Map(sample.chosen.map((c) => [c.muminId, c.fullName]));
  const recipients: CommittedRecipient[] = (inserted as { id: string; mumin_id: string; phone_e164: string; token: string }[]).map((r) => ({
    recipientId: r.id,
    muminId: r.mumin_id,
    phone: r.phone_e164,
    name: nameByMumin.get(r.mumin_id) ?? null,
    token: r.token,
    link: surveyLink(r.token),
  }));

  await supabase.from("survey_forms").update({ status: "sampled" }).eq("id", formId);

  // Optional WhatsApp dispatch — gated by env so the build doesn't depend on template approval.
  const sendEnabled = process.env.SURVEY_SEND_ENABLED === "true";
  const templateCode = process.env.SURVEY_WA_TEMPLATE;
  if (!sendEnabled || !templateCode) {
    return { formId, funnel: sample.funnel, recipients, sent: false };
  }

  const broadcastRecipients: Recipient[] = recipients.map((r) => ({
    phone: r.phone,
    familyId: null,
    muminId: r.muminId,
    fields: { survey_token: r.token, first_name: (r.name ?? "").split(" ")[0] || "Mumin" },
  }));
  const result = await createBroadcast({
    templateCode,
    recipients: broadcastRecipients,
    audienceKey: "custom",
    // URL button suffix = the per-recipient token; body {{1}} (if any) = first name.
    variableBindings: {
      urlButton: { kind: "field", field: "survey_token" },
      body: { "1": { kind: "field", field: "first_name" } },
    },
  });
  if ("error" in result) {
    return { formId, funnel: sample.funnel, recipients, sent: false, sendError: result.error };
  }

  await supabase.from("survey_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("form_id", formId).eq("status", "sampled");
  await supabase.from("survey_forms").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", formId);
  return { formId, funnel: sample.funnel, recipients, sent: true };
}
