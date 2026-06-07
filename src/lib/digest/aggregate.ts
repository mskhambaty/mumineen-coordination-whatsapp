import { getSupabaseAdmin } from "@/lib/supabase/server";

// Aggregate a day's activity per department for the nightly digest. Pulls only cleanly
// department-attributable signals: feedback (feedback_entries), issues (tasks created that day),
// escalations (conversation_sessions escalated that day), plus an all-up view that also folds in
// the day's flagged knowledge gaps and the next day's meal RSVP totals (for the kitchen).

export type DeptMetrics = {
  department_id: string | null;
  department_name: string;
  feedback: { total: number; positive: number; neutral: number; negative: number; samples: string[] };
  issues: number;
  escalations: number;
};

export type AllUpExtras = {
  questions_flagged: number; // knowledge gaps seen today
  meals_next_day: { date: string | null; lunch_attending: number; dinner_attending: number };
};

function dayBounds(date: string): { start: string; end: string } {
  // date = YYYY-MM-DD (treated as a UTC day window; good enough for a nightly rollup).
  const start = new Date(`${date}T00:00:00.000Z`).toISOString();
  const end = new Date(`${date}T23:59:59.999Z`).toISOString();
  return { start, end };
}

// Per-department metrics for a given day. Returns one entry per department that had any activity,
// plus departments are looked up for names.
export async function aggregateDepartments(date: string): Promise<DeptMetrics[]> {
  const supabase = getSupabaseAdmin();
  const { start, end } = dayBounds(date);

  const [{ data: depts }, { data: feedback }, { data: issues }, { data: escal }] = await Promise.all([
    supabase.from("departments").select("id, name"),
    supabase
      .from("feedback_entries")
      .select("department_id, sentiment, comment_text")
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
      };
      metrics.set(id, m);
    }
    return m;
  };

  for (const f of (feedback ?? []) as { department_id: string | null; sentiment: string | null; comment_text: string | null }[]) {
    if (!f.department_id) continue;
    const m = ensure(f.department_id);
    m.feedback.total++;
    if (f.sentiment === "positive") m.feedback.positive++;
    else if (f.sentiment === "negative") m.feedback.negative++;
    else m.feedback.neutral++;
    if (f.comment_text && m.feedback.samples.length < 5) m.feedback.samples.push(f.comment_text);
  }
  for (const t of (issues ?? []) as { department_id: string | null }[]) {
    if (t.department_id) ensure(t.department_id).issues++;
  }
  for (const e of (escal ?? []) as { escalation_department_id: string | null }[]) {
    if (e.escalation_department_id) ensure(e.escalation_department_id).escalations++;
  }

  return [...metrics.values()].sort((a, b) => b.feedback.total + b.issues + b.escalations - (a.feedback.total + a.issues + a.escalations));
}

// All-up extras: knowledge gaps surfaced today + the next day's meal RSVP attendance totals.
export async function aggregateAllUpExtras(date: string): Promise<AllUpExtras> {
  const supabase = getSupabaseAdmin();
  const { start, end } = dayBounds(date);

  const { count: gapsCount } = await supabase
    .from("knowledge_gaps")
    .select("id", { count: "exact", head: true })
    .gte("last_seen_at", start)
    .lte("last_seen_at", end);

  // Next day's meals.
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);

  const { data: slots } = await supabase
    .from("rsvp_registration_instance")
    .select("id, meal")
    .eq("event_date", nextDate);

  let lunch = 0;
  let dinner = 0;
  for (const slot of (slots ?? []) as { id: string; meal: string }[]) {
    const total = await latestAttendingHeadCount(slot.id);
    if (slot.meal === "lunch") lunch += total;
    else dinner += total;
  }

  return {
    questions_flagged: gapsCount ?? 0,
    meals_next_day: { date: (slots ?? []).length ? nextDate : null, lunch_attending: lunch, dinner_attending: dinner },
  };
}

// Sum of the latest 'yes' head counts per family for one meal slot.
async function latestAttendingHeadCount(instanceId: string): Promise<number> {
  const { data } = await getSupabaseAdmin()
    .from("rsvp_responses")
    .select("family_id, response, head_count, submitted_at")
    .eq("registration_instance_id", instanceId)
    .order("submitted_at", { ascending: false });

  const seen = new Set<string>();
  let total = 0;
  for (const r of (data ?? []) as { family_id: string; response: string | null; head_count: number | null }[]) {
    if (seen.has(r.family_id)) continue;
    seen.add(r.family_id);
    if (r.response === "yes") total += r.head_count ?? 0;
  }
  return total;
}
