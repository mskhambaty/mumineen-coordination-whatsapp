import { getSupabaseAdmin } from "@/lib/supabase/server";

// Aggregate a day's activity per department for the nightly digest. Pulls only cleanly
// department-attributable signals: feedback (feedback_entries), issues (tasks created that day),
// escalations (conversation_sessions escalated that day), plus an all-up view that also folds in
// the day's flagged knowledge gaps.

export type DeptMetrics = {
  department_id: string | null;
  department_name: string;
  feedback: { total: number; positive: number; neutral: number; negative: number; samples: string[] };
  issues: number;
  escalations: number;
  open_tickets: number;
  open_ticket_titles: string[];
};

export type AllUpExtras = {
  questions_flagged: number; // knowledge gaps seen today
  untriaged_issues: number; // agent-raised issues with no department assigned
  total_open_tickets: number;
};

// America/Chicago UTC offset (minutes) for a given calendar date — DST-aware.
function chicagoOffsetMinutes(date: string): number {
  const probe = new Date(`${date}T12:00:00Z`);
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
      .formatToParts(probe)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const m = name.match(/GMT([+-]\d+)(?::(\d+))?/);
  const hours = m ? parseInt(m[1], 10) : -5;
  const mins = m && m[2] ? parseInt(m[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -mins : mins);
}

// UTC bounds for one America/Chicago calendar day, so timestamptz columns (created_at,
// escalated_at) are matched against the same day the cron and feedback event_date use.
function dayBounds(date: string): { start: string; end: string } {
  const offsetMin = chicagoOffsetMinutes(date);
  const startMs = new Date(`${date}T00:00:00.000Z`).getTime() - offsetMin * 60000;
  const start = new Date(startMs).toISOString();
  const end = new Date(startMs + 24 * 60 * 60 * 1000 - 1).toISOString();
  return { start, end };
}

// Per-department metrics for a given day. Returns one entry per department that had any activity,
// plus departments are looked up for names.
export async function aggregateDepartments(date: string): Promise<DeptMetrics[]> {
  const supabase = getSupabaseAdmin();
  const { start, end } = dayBounds(date);

  const [{ data: depts }, { data: feedback }, { data: issues }, { data: escal }, { data: openTickets }] = await Promise.all([
    supabase.from("departments").select("id, name"),
    supabase
      .from("feedback_entries")
      .select("department_ids, sentiment, comment_text")
      .eq("event_date", date),
    supabase
      .from("tasks")
      .select("department_id, created_at")
      .gte("created_at", start)
      .lte("created_at", end)
      .not("department_id", "is", null),
    supabase
      .from("conversation_sessions")
      .select("escalation_department_id, escalated_at")
      .gte("escalated_at", start)
      .lte("escalated_at", end)
      .not("escalation_department_id", "is", null),
    supabase
      .from("tasks")
      .select("department_id, title, priority")
      .eq("archived", false)
      .neq("status", "complete")
      .not("department_id", "is", null),
  ]);

  const nameById = new Map<string, string>();
  for (const d of (depts ?? []) as { id: string; name: string }[]) nameById.set(d.id, d.name);

  const metrics = new Map<string, DeptMetrics>();
  const ensure = (id: string): DeptMetrics => {
    let m = metrics.get(id);
    if (!m) {
      m = {
        department_id: id,
        department_name: nameById.get(id) ?? "Unknown",
        feedback: { total: 0, positive: 0, neutral: 0, negative: 0, samples: [] },
        issues: 0,
        escalations: 0,
        open_tickets: 0,
        open_ticket_titles: [],
      };
      metrics.set(id, m);
    }
    return m;
  };

  // A feedback entry may be tagged to multiple departments — credit each one.
  for (const f of (feedback ?? []) as { department_ids: string[] | null; sentiment: string | null; comment_text: string | null }[]) {
    for (const deptId of f.department_ids ?? []) {
      if (!deptId) continue;
      const m = ensure(deptId);
      m.feedback.total++;
      if (f.sentiment === "positive") m.feedback.positive++;
      else if (f.sentiment === "negative") m.feedback.negative++;
      else m.feedback.neutral++;
      if (f.comment_text && m.feedback.samples.length < 5) m.feedback.samples.push(f.comment_text);
    }
  }
  for (const t of (issues ?? []) as { department_id: string | null }[]) {
    if (t.department_id) ensure(t.department_id).issues++;
  }
  for (const e of (escal ?? []) as { escalation_department_id: string | null }[]) {
    if (e.escalation_department_id) ensure(e.escalation_department_id).escalations++;
  }
  for (const t of (openTickets ?? []) as { department_id: string | null; title: string; priority: string | null }[]) {
    if (!t.department_id) continue;
    const m = ensure(t.department_id);
    m.open_tickets++;
    if (m.open_ticket_titles.length < 5) m.open_ticket_titles.push(t.title);
  }

  return [...metrics.values()].sort((a, b) => b.feedback.total + b.issues + b.escalations - (a.feedback.total + a.issues + a.escalations));
}

// All-up extras: knowledge gaps surfaced today.
export async function aggregateAllUpExtras(date: string): Promise<AllUpExtras> {
  const supabase = getSupabaseAdmin();
  const { start, end } = dayBounds(date);

  const { count: gapsCount } = await supabase
    .from("knowledge_gaps")
    .select("id", { count: "exact", head: true })
    .gte("last_seen_at", start)
    .lte("last_seen_at", end);

  // Agent-raised issues that landed with no department (untriaged) — surfaced to leadership.
  const [{ count: untriagedCount }, { count: openTicketCount }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("source", "whatsapp_agent")
      .is("department_id", null)
      .gte("created_at", start)
      .lte("created_at", end),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("archived", false)
      .neq("status", "complete"),
  ]);

  return {
    questions_flagged: gapsCount ?? 0,
    untriaged_issues: untriagedCount ?? 0,
    total_open_tickets: openTicketCount ?? 0,
  };
}
