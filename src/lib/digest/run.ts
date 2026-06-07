import { AI_MODEL, SUMMARY_TEMPERATURE, MAX_SUMMARY_TOKENS, chatParams, getAIClient } from "@/lib/ai/model";
import { sendRawEmail } from "@/lib/email/postmark";
import { sendWhatsAppText } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin, recordOutboundMessage } from "@/lib/supabase/server";
import { aggregateAllUpExtras, aggregateDepartments, type AllUpExtras, type DeptMetrics } from "@/lib/digest/aggregate";

// Build, store, and distribute the nightly department digest for a date. One stored briefing per
// department that had activity, plus an all-up leadership briefing. Distribution: email to opted-in
// department members (daily_feedback_digest = true) and a free in-window WhatsApp summary.

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type DigestRunResult = { date: string; departments: number; emails: number; whatsapp: number; errors: string[] };

function metricsLine(m: DeptMetrics): string {
  const f = m.feedback;
  return `${m.department_name}: ${f.total} feedback (${f.positive}+/${f.neutral}~/${f.negative}-), ${m.issues} issues, ${m.escalations} escalations`;
}

async function briefing(system: string, payload: unknown): Promise<string> {
  try {
    const client = getAIClient();
    const res = await client.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_SUMMARY_TOKENS, temperature: SUMMARY_TEMPERATURE }),
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error("Digest briefing generation failed:", err);
    return "";
  }
}

const DEPT_SYSTEM =
  "You write a brief (4-6 bullet) end-of-day committee briefing for a Dawoodi Bohra Ashara relay center department. " +
  "Use only the JSON metrics provided. Cover: overall sentiment, the top problems/themes from feedback, issue/escalation load, and ONE concrete suggestion to improve tomorrow. Be concise and practical. No preamble.";

const ALLUP_SYSTEM =
  "You write a short leadership end-of-day summary across all departments of a Dawoodi Bohra Ashara relay center. " +
  "Use only the JSON provided. Cover: overall mood, departments needing attention, total issues/escalations, the next day's expected meal counts, and 1-2 priorities for tomorrow. Be concise. No preamble.";

async function upsertSummary(departmentId: string | null, date: string, metrics: unknown, aiBriefing: string) {
  const supabase = getSupabaseAdmin();
  // Manual upsert on the partial-unique (department_id, summary_date) keys.
  const query = supabase.from("department_daily_summaries").select("id").eq("summary_date", date);
  const { data: existing } = departmentId
    ? await query.eq("department_id", departmentId).maybeSingle()
    : await query.is("department_id", null).maybeSingle();

  if (existing) {
    await supabase.from("department_daily_summaries").update({ metrics, ai_briefing: aiBriefing }).eq("id", existing.id);
  } else {
    await supabase.from("department_daily_summaries").insert({ department_id: departmentId, summary_date: date, metrics, ai_briefing: aiBriefing });
  }
}

type Member = { user_id: string; email: string | null; phone_e164: string | null };

async function deptRecipients(departmentId: string): Promise<Member[]> {
  const { data } = await getSupabaseAdmin()
    .from("department_members")
    .select("user_id, daily_feedback_digest, is_active, whatsapp_users(email, phone_e164, status)")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .eq("daily_feedback_digest", true);
  return ((data ?? []) as unknown as { user_id: string; whatsapp_users: { email: string | null; phone_e164: string | null; status: string } | null }[])
    .filter((r) => r.whatsapp_users && r.whatsapp_users.status === "active")
    .map((r) => ({ user_id: r.user_id, email: r.whatsapp_users!.email, phone_e164: r.whatsapp_users!.phone_e164 }));
}

async function leadershipRecipients(): Promise<Member[]> {
  const { data } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .select("id, email, phone_e164, role, global_role, status")
    .eq("status", "active")
    .or("role.eq.admin,global_role.eq.leadership_admin");
  return ((data ?? []) as { id: string; email: string | null; phone_e164: string | null }[]).map((u) => ({
    user_id: u.id,
    email: u.email,
    phone_e164: u.phone_e164,
  }));
}

async function inWindowPhones(): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data } = await getSupabaseAdmin().from("conversation_sessions").select("phone_e164").gte("last_message_at", cutoff);
  return new Set(((data ?? []) as { phone_e164: string }[]).map((r) => r.phone_e164));
}

async function distribute(
  recipients: Member[],
  subject: string,
  body: string,
  inWindow: Set<string>,
  counters: { emails: number; whatsapp: number; errors: string[] },
) {
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  for (const r of recipients) {
    if (r.email && !seenEmail.has(r.email)) {
      seenEmail.add(r.email);
      try {
        await sendRawEmail(r.email, subject, `<pre style="font-family:sans-serif;white-space:pre-wrap">${body}</pre>`, body);
        counters.emails++;
      } catch (err) {
        counters.errors.push(`email ${r.user_id}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    // Free in-window WhatsApp summary only (out-of-window needs an approved template — follow-up).
    if (r.phone_e164 && inWindow.has(r.phone_e164) && !seenPhone.has(r.phone_e164)) {
      seenPhone.add(r.phone_e164);
      try {
        const res = await sendWhatsAppText(r.phone_e164, body);
        await recordOutboundMessage({
          phoneE164: r.phone_e164,
          body,
          whatsappMessageId: res.messages?.[0]?.id,
          rawPayload: { source: "department_digest" },
        });
        counters.whatsapp++;
      } catch (err) {
        counters.errors.push(`wa ${r.user_id}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
  }
}

export async function runDepartmentDigest(date: string): Promise<DigestRunResult> {
  const result: DigestRunResult = { date, departments: 0, emails: 0, whatsapp: 0, errors: [] };

  const deptMetrics = await aggregateDepartments(date);
  const extras: AllUpExtras = await aggregateAllUpExtras(date);
  const inWindow = await inWindowPhones();

  // Per-department briefings (only those with activity) + distribution.
  for (const m of deptMetrics) {
    if (!m.department_id) continue;
    const hasActivity = m.feedback.total + m.issues + m.escalations > 0;
    if (!hasActivity) continue;

    const ai = await briefing(DEPT_SYSTEM, m);
    await upsertSummary(m.department_id, date, m, ai);
    result.departments++;

    const body = `${m.department_name} — daily summary (${date})\n\n${ai || metricsLine(m)}`;
    const recipients = await deptRecipients(m.department_id);
    await distribute(recipients, `[${m.department_name}] Daily summary ${date}`, body, inWindow, result);
  }

  // All-up leadership briefing.
  const allUpPayload = { date, departments: deptMetrics.map(metricsLine), ...extras };
  const allUpAi = await briefing(ALLUP_SYSTEM, allUpPayload);
  await upsertSummary(null, date, allUpPayload, allUpAi);

  const allUpBody =
    `All-up daily summary (${date})\n\n${allUpAi || deptMetrics.map(metricsLine).join("\n")}\n\n` +
    `Next-day meals: lunch ${extras.meals_next_day.lunch_attending}, dinner ${extras.meals_next_day.dinner_attending}.`;
  const leaders = await leadershipRecipients();
  await distribute(leaders, `[All-up] Daily summary ${date}`, allUpBody, inWindow, result);

  return result;
}
