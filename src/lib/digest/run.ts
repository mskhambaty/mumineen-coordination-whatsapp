import { AI_MODEL, SUMMARY_TEMPERATURE, MAX_SUMMARY_TOKENS, chatParams, getAIClient } from "@/lib/ai/model";
import { sendDepartmentSummaryEmail } from "@/lib/email/postmark";
import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { sendTemplateNotification } from "@/lib/whatsapp/send-template";
import { aggregateAllUpExtras, aggregateDepartments, type AllUpExtras, type DeptMetrics } from "@/lib/digest/aggregate";

// Build, store, and distribute the nightly department digest for a date. Per department that had
// activity we generate TWO summaries — a short one-liner for the WhatsApp template and a longer
// bullet list for the email + dashboard — store both, and distribute via the
// daily_department_issue_confirmation Meta template and the daily-department-summary Postmark
// template. An all-up summary goes to Project Management + Leadership + admin/leadership.
//
// Recipients are per (department, member): a user in N departments receives N messages.

const WA_TEMPLATE = optionalEnv("DEPARTMENT_SUMMARY_WA_TEMPLATE") ?? "daily_department_issue_confirmation";
const ALL_UP_LABEL = "All Departments";

export type DigestRunResult = { date: string; departments: number; emails: number; whatsapp: number; errors: string[] };

type Summary = { short: string; bullets: string[] };

function metricsLine(m: DeptMetrics): string {
  const f = m.feedback;
  return `${f.total} feedback (${f.positive}+/${f.neutral}~/${f.negative}-), ${m.issues} issues, ${m.escalations} escalations`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlList(bullets: string[]): string {
  if (bullets.length === 0) return "<p>No notable feedback today.</p>";
  return `<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`;
}
function textList(bullets: string[]): string {
  return bullets.length ? bullets.map((b) => `- ${b}`).join("\n") : "No notable feedback today.";
}
function stripFences(s: string): string {
  return s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

const DEPT_SYSTEM =
  "You write an end-of-day committee briefing for one department of a Dawoodi Bohra Ashara relay center, using ONLY the JSON metrics provided. " +
  'Reply with STRICT JSON: {"short": string, "bullets": string[]}. ' +
  '"short" = ONE plain sentence (max 160 chars) capturing the single most important feedback/issue for that department today (for a WhatsApp message). ' +
  '"bullets" = 3-6 concise bullet strings covering sentiment, top feedback themes, issues/escalations, and one improvement suggestion. No markdown, no preamble.';

const ALLUP_SYSTEM =
  "You write a short leadership end-of-day summary ACROSS ALL departments of a Dawoodi Bohra Ashara relay center, using ONLY the JSON provided. " +
  'Reply with STRICT JSON: {"short": string, "bullets": string[]}. ' +
  '"short" = ONE sentence (max 160 chars) on the overall day for a WhatsApp message. ' +
  '"bullets" = 4-7 bullets: overall mood, departments needing attention, total issues/escalations, next-day expected meal counts, and 1-2 priorities. No markdown.';

async function generateSummary(system: string, payload: unknown, fallbackShort: string): Promise<Summary> {
  try {
    const client = getAIClient();
    const res = await client.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_SUMMARY_TOKENS, temperature: SUMMARY_TEMPERATURE }),
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    const raw = stripFences(res.choices[0]?.message?.content?.trim() ?? "");
    const parsed = JSON.parse(raw) as { short?: unknown; bullets?: unknown };
    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets.map((b) => String(b)).filter(Boolean) : [];
    const short = typeof parsed.short === "string" && parsed.short.trim() ? parsed.short.trim() : fallbackShort;
    return { short: short.slice(0, 280), bullets };
  } catch (err) {
    console.error("Digest summary generation failed:", err);
    return { short: fallbackShort.slice(0, 280), bullets: [] };
  }
}

async function upsertSummary(departmentId: string | null, date: string, metrics: unknown, s: Summary) {
  const supabase = getSupabaseAdmin();
  const long = textList(s.bullets);
  const query = supabase.from("department_daily_summaries").select("id").eq("summary_date", date);
  const { data: existing } = departmentId
    ? await query.eq("department_id", departmentId).maybeSingle()
    : await query.is("department_id", null).maybeSingle();

  const fields = { metrics, ai_briefing: long, ai_briefing_short: s.short };
  if (existing) {
    await supabase.from("department_daily_summaries").update(fields).eq("id", existing.id);
  } else {
    await supabase.from("department_daily_summaries").insert({ department_id: departmentId, summary_date: date, ...fields });
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

// All-up recipients: admin/leadership-role users + active members (opted in) of the Project
// Management and Leadership departments.
async function allUpRecipients(): Promise<Member[]> {
  const supabase = getSupabaseAdmin();
  const byUser = new Map<string, Member>();

  const { data: leaders } = await supabase
    .from("whatsapp_users")
    .select("id, email, phone_e164, status")
    .eq("status", "active")
    .or("role.eq.admin,global_role.eq.leadership_admin");
  for (const u of (leaders ?? []) as { id: string; email: string | null; phone_e164: string | null }[]) {
    byUser.set(u.id, { user_id: u.id, email: u.email, phone_e164: u.phone_e164 });
  }

  const { data: depts } = await supabase.from("departments").select("id, name").in("name", ["Project Management", "Leadership"]);
  const deptIds = ((depts ?? []) as { id: string }[]).map((d) => d.id);
  if (deptIds.length > 0) {
    for (const id of deptIds) {
      for (const m of await deptRecipients(id)) byUser.set(m.user_id, m);
    }
  }
  return [...byUser.values()];
}

async function distribute(
  recipients: Member[],
  departmentLabel: string,
  s: Summary,
  counters: { emails: number; whatsapp: number; errors: string[] },
) {
  const feedbackHtml = htmlList(s.bullets);
  const feedbackText = textList(s.bullets);
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();

  for (const r of recipients) {
    if (r.email && !seenEmail.has(r.email)) {
      seenEmail.add(r.email);
      try {
        await sendDepartmentSummaryEmail(r.email, { department_name: departmentLabel, feedback_html: feedbackHtml, feedback_text: feedbackText });
        counters.emails++;
      } catch (err) {
        counters.errors.push(`email ${r.user_id}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    if (r.phone_e164 && !seenPhone.has(r.phone_e164)) {
      seenPhone.add(r.phone_e164);
      const res = await sendTemplateNotification({
        phoneE164: r.phone_e164,
        userId: r.user_id,
        templateName: WA_TEMPLATE,
        bodyParams: [departmentLabel, s.short || "See dashboard for today's summary."],
        source: "department_digest",
      });
      if (res.status === "sent") counters.whatsapp++;
      else counters.errors.push(`wa ${r.user_id}: ${res.error ?? "failed"}`);
    }
  }
}

export async function runDepartmentDigest(date: string): Promise<DigestRunResult> {
  const result: DigestRunResult = { date, departments: 0, emails: 0, whatsapp: 0, errors: [] };

  const deptMetrics = await aggregateDepartments(date);
  const extras: AllUpExtras = await aggregateAllUpExtras(date);

  for (const m of deptMetrics) {
    if (!m.department_id) continue;
    if (m.feedback.total + m.issues + m.escalations === 0) continue;

    const fallback = `${m.department_name}: ${metricsLine(m)}`;
    const summary = await generateSummary(DEPT_SYSTEM, m, fallback);
    if (summary.bullets.length === 0) summary.bullets = [metricsLine(m), ...m.feedback.samples];

    await upsertSummary(m.department_id, date, m, summary);
    result.departments++;

    await distribute(await deptRecipients(m.department_id), m.department_name, summary, result);
  }

  // All-up.
  const allUpPayload = { date, departments: deptMetrics.map((m) => ({ name: m.department_name, ...m, summary: metricsLine(m) })), ...extras };
  const allUpFallback = `Next-day meals: lunch ${extras.meals_next_day.lunch_attending}, dinner ${extras.meals_next_day.dinner_attending}.`;
  const allUpSummary = await generateSummary(ALLUP_SYSTEM, allUpPayload, allUpFallback);
  if (allUpSummary.bullets.length === 0) allUpSummary.bullets = deptMetrics.map((m) => `${m.department_name}: ${metricsLine(m)}`);
  await upsertSummary(null, date, allUpPayload, allUpSummary);

  await distribute(await allUpRecipients(), ALL_UP_LABEL, allUpSummary, result);

  return result;
}
