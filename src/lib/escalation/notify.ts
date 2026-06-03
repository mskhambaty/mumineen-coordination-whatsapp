import { sendEscalationEmail } from "@/lib/email/postmark";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const ONCALL_TIMEZONE = "America/Chicago";
const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type OnCallMember = { name: string; email: string };

type MemberRow = {
  user: { display_name: string | null; email: string | null } | null;
  hours: { day_of_week: number; start_time: string; end_time: string }[] | null;
};

// Current weekday (0-6) and HH:MM in the on-call timezone.
function nowInOnCallTz(): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ONCALL_TIMEZONE,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const day = DAY_INDEX[map.weekday] ?? 0;
  const hour = map.hour === "24" ? "00" : map.hour; // some runtimes emit "24" at midnight
  return { day, time: `${hour}:${map.minute}` };
}

function isOnCall(hours: MemberRow["hours"], day: number, time: string): boolean {
  return (hours ?? []).some((h) => {
    if (h.day_of_week !== day) return false;
    if (h.start_time <= h.end_time) {
      // Same-day range (end "00:00" is treated as the literal start of day).
      return h.start_time <= time && time < h.end_time;
    }
    // Overnight range (e.g. 21:00–06:00): on call from start to midnight, and after midnight to end.
    return time >= h.start_time || time < h.end_time;
  });
}

// On-call escalation members, scoped to a department.
//  - departmentId set   → only that department's escalation members (strict; no fallback).
//  - departmentId null  → ALL escalation members (used when no department was determined).
// Deduped by email (a user can cover multiple departments).
export async function getOnCallSupportMembers(departmentId?: string | null): Promise<OnCallMember[]> {
  let query = getSupabaseAdmin()
    .from("escalation_support_members")
    .select("user:whatsapp_users(display_name, email), hours:escalation_oncall_hours(day_of_week, start_time, end_time)");

  if (departmentId) {
    query = query.eq("department_id", departmentId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const { day, time } = nowInOnCallTz();
  const byEmail = new Map<string, OnCallMember>();
  for (const row of data as unknown as MemberRow[]) {
    const email = row.user?.email?.trim();
    if (!email || byEmail.has(email)) continue;
    if (isOnCall(row.hours, day, time)) {
      byEmail.set(email, { name: row.user?.display_name || "Support", email });
    }
  }
  return [...byEmail.values()];
}

export type EscalationNotice = {
  guestName: string;
  guestPhone: string;
  reason: string;
  priority: "normal" | "urgent";
  category: string;
  conversationUrl: string;
  departmentId?: string | null;
};

// Email the on-call escalation members for the notice's department (or everyone on-call if
// no department). Fire-and-forget per recipient; failures are logged, never thrown.
export async function notifyOnCallSupport(notice: EscalationNotice): Promise<number> {
  const members = await getOnCallSupportMembers(notice.departmentId ?? null);
  await Promise.all(
    members.map((member) =>
      sendEscalationEmail(member.email, {
        name: member.name,
        guest_name: notice.guestName,
        guest_phone: notice.guestPhone,
        reason: notice.reason,
        priority: notice.priority,
        priority_label: notice.priority === "urgent" ? "URGENT" : "Normal",
        category: notice.category,
        conversation_url: notice.conversationUrl,
        product_name: "Anjuman e Saifee Chicago Portal",
      }).catch((err) => console.error(`Escalation email to ${member.email} failed:`, err)),
    ),
  );
  return members.length;
}
