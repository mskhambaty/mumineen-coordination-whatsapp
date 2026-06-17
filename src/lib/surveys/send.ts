import { getSupabaseAdmin } from "@/lib/supabase/server";
import { createBroadcast } from "@/lib/whatsapp/broadcast";
import type { AudienceKey, Recipient } from "@/lib/whatsapp/audience";

// audience_key tag stamped on survey broadcasts so the feedback console can list/scope their
// delivery history (mirrors the Niyaz "niyaz_rsvp" tag). Not a resolvable audience — recipients are
// always passed explicitly — so it's cast onto the label field only.
export const SURVEY_AUDIENCE_KEY = "feedback_survey" as AudienceKey;
import type { RuleGroup } from "@/lib/whatsapp/audience-filter";
import { resolveApprovedTemplateForAnyAccount } from "@/lib/whatsapp/send-template";
import { suggestSample, type SampleResult } from "@/lib/surveys/sampling";
import { generateSurveyToken, chicagoToday } from "@/lib/surveys/tokens";

// The roster's full_name already carries the honorific (e.g. "Murtaza bhai Alihusain bhai
// Bhinderwala"), so the template's name variable uses the full name verbatim — no first-name split.
export function displayName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim() || "Mumin";
}

type DispatchPerson = { phone: string; token: string; name: string | null; muminId?: string | null; familyId?: string | null };

// Queue the WhatsApp template to a set of recipients. Resolves the template (and the WABA/number it
// lives in) from Meta, binds EVERY body variable the template declares to the name honorific, and
// sets the dynamic URL-button suffix to `feedback/s/<token>` (the template's base URL is the site
// root). Works whether the body var is positional ({{1}}) or named (e.g. mumin_name).
async function dispatchSurveyTemplate(templateCode: string, people: DispatchPerson[]): Promise<{ ok: true } | { error: string }> {
  let resolved;
  try {
    resolved = await resolveApprovedTemplateForAnyAccount(templateCode);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Template not found." };
  }
  const { account, descriptor } = resolved;
  const body = Object.fromEntries(descriptor.bodyVars.map((tok) => [tok, { kind: "field" as const, field: "display_name" }]));
  const recipients: Recipient[] = people.map((p) => ({
    phone: p.phone,
    familyId: p.familyId ?? null,
    muminId: p.muminId ?? null,
    fields: { url_suffix: `feedback/s/${p.token}`, display_name: displayName(p.name) },
  }));
  const result = await createBroadcast({
    templateCode,
    account,
    recipients,
    audienceKey: SURVEY_AUDIENCE_KEY,
    variableBindings: { urlButton: { kind: "field", field: "url_suffix" }, body },
  });
  if ("error" in result) return { error: result.error };
  return { ok: true };
}

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

// Resolve which template to send with: an explicitly chosen template (from the admin dropdown)
// always wins; otherwise fall back to the env default, but only when SURVEY_SEND_ENABLED is on.
export function resolveSurveyTemplate(explicit?: string | null): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  return process.env.SURVEY_SEND_ENABLED === "true" ? process.env.SURVEY_WA_TEMPLATE || undefined : undefined;
}

// Send a single survey link to one phone via the WhatsApp template (used for "send a test to a
// specific person"). Pass an explicit templateCode (admin dropdown) or rely on the env default.
// Queues via the broadcast engine (the drain cron delivers). Returns delivered=true when queued.
export async function deliverSurveyLink(phone: string, token: string, name: string | null, templateCodeOverride?: string | null): Promise<{ delivered: boolean; error?: string }> {
  const templateCode = resolveSurveyTemplate(templateCodeOverride);
  if (!templateCode) {
    return { delivered: false, error: "No WhatsApp template selected (pick one from the dropdown, or set SURVEY_SEND_ENABLED + SURVEY_WA_TEMPLATE). Copy the link and send it manually." };
  }
  const r = await dispatchSurveyTemplate(templateCode, [{ phone, token, name }]);
  if ("error" in r) return { delivered: false, error: r.error };
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

type FormRow = { id: string; group_id: string | null; rules: RuleGroup | null; sample_size: number; status: string };

export async function commitAndSendForm(formId: string, templateCodeOverride?: string | null, freeWindowOnly = false): Promise<CommitResult | { error: string }> {
  const supabase = getSupabaseAdmin();
  const eventDate = chicagoToday();

  const { data: form } = await supabase
    .from("survey_forms")
    .select("id, group_id, rules, sample_size, status")
    .eq("id", formId)
    .maybeSingle();
  if (!form) return { error: "Form not found." };
  const f = form as FormRow;
  if (f.status === "sent") return { error: "This form has already been sent." };

  // Target is a saved group (group_id) OR an ad-hoc custom filter (rules) stored on the form.
  let targetRules: RuleGroup | null = f.rules;
  if (f.group_id) {
    const { data: group } = await supabase
      .from("survey_groups")
      .select("id, rules")
      .eq("id", f.group_id)
      .maybeSingle();
    if (!group) return { error: "Target group not found." };
    targetRules = (group as { rules: RuleGroup }).rules;
  }
  if (!targetRules) return { error: "Form has no target group or filter." };

  const { data: fqs } = await supabase
    .from("survey_form_questions")
    .select("question_id")
    .eq("form_id", formId);
  const questionIds = ((fqs ?? []) as { question_id: string | null }[])
    .map((q) => q.question_id)
    .filter((id): id is string => Boolean(id));
  if (questionIds.length === 0) return { error: "Form has no questions composed." };

  // Sample fresh-first, excluding today's other samples and question-exhausted mumineen.
  const sample = await suggestSample(targetRules, questionIds, f.sample_size, eventDate, { freeWindowOnly });
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
  const insertedRows = inserted as { id: string; mumin_id: string; phone_e164: string; token: string }[];
  const recipients: CommittedRecipient[] = insertedRows.map((r) => ({
    recipientId: r.id,
    muminId: r.mumin_id,
    phone: r.phone_e164,
    name: nameByMumin.get(r.mumin_id) ?? null,
    token: r.token,
    link: surveyLink(r.token),
  }));

  await supabase.from("survey_forms").update({ status: "sampled" }).eq("id", formId);

  // WhatsApp dispatch: an explicitly selected template (admin dropdown) sends directly; otherwise
  // fall back to the env default only when SURVEY_SEND_ENABLED is on. No template → just committed.
  const templateCode = resolveSurveyTemplate(templateCodeOverride);
  if (!templateCode) {
    return { formId, funnel: sample.funnel, recipients, sent: false };
  }

  const dispatch = await dispatchSurveyTemplate(
    templateCode,
    insertedRows.map((r) => ({ phone: r.phone_e164, token: r.token, name: nameByMumin.get(r.mumin_id) ?? null, muminId: r.mumin_id })),
  );
  if ("error" in dispatch) {
    return { formId, funnel: sample.funnel, recipients, sent: false, sendError: dispatch.error };
  }

  await supabase.from("survey_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("form_id", formId).eq("status", "sampled");
  await supabase.from("survey_forms").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", formId);
  return { formId, funnel: sample.funnel, recipients, sent: true };
}
