import { runFilter, type RuleGroup, type RosterRow } from "@/lib/whatsapp/audience-filter";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { chicagoToday } from "@/lib/surveys/tokens";

// Sampling + question-rotation engine for targeted feedback surveys.
//
// Goals (locked with the user):
//  - Prefer FRESH people (never surveyed) over reused ones.
//  - Never re-ask a (mumin, question) for the whole event → exclude candidates already exposed to
//    EVERY question in this form.
//  - A mumin appears in at most ONE of the day's samples → exclude anyone already sampled today.

export type SampleCandidate = {
  muminId: string;
  familyId: string | null;
  its: string;
  phone: string;
  fullName: string | null;
  gender: string | null;
  priorSends: number; // how many surveys they've previously been sent (freshness)
};

export type SampleResult = {
  chosen: SampleCandidate[];
  funnel: {
    candidates: number; // matched the group + reachable + attending + registration submitted
    excludedNotAttending: number; // matched + reachable but flagged not attending
    excludedUnregistered: number; // matched + reachable + attending but registration not submitted
    excludedToday: number; // already in one of today's samples
    excludedExhausted: number; // already exposed to every question in this form
    excludedNonResponder: number; // sent NON_RESPONDER_SEND_CAP+ times, never responded → stop asking
    excludedAlreadySent: number; // opt-in: already sent ANY survey this event (cross-form de-overlap)
    fresh: number; // of chosen, never previously surveyed
    reused: number; // of chosen, surveyed before
    chosen: number;
  };
};

// Stop including someone once they've been SENT this many real surveys without ever responding.
export const NON_RESPONDER_SEND_CAP = 2;

// Suggest a sample of up to `size` mumineen for a form targeting `groupRules`, given the form's
// question ids (for once-per-event dedup). Fresh-first, then least-previously-sent, then
// longest-since-last-sent.
export async function suggestSample(
  groupRules: RuleGroup,
  formQuestionIds: string[],
  size: number,
  eventDate: string = chicagoToday(),
  opts: { freeWindowOnly?: boolean; windowHours?: number; excludeAlreadySent?: boolean } = {},
): Promise<SampleResult> {
  const supabase = getSupabaseAdmin();

  // 1. Resolve the group to reachable mumineen (runFilter already dedups by phone + requires a number).
  // Optionally restrict to the free messaging window — people who messaged us within `windowHours`
  // — so the template send costs nothing. Done by AND-ing the group with the engagement rule.
  const effectiveRules: RuleGroup = opts.freeWindowOnly
    ? { combinator: "and", rules: [groupRules, { field: "hours_since_last_inbound", operator: "<=", value: opts.windowHours ?? 24 }] }
    : groupRules;
  const rows: RosterRow[] = await runFilter(effectiveRules);
  // Baseline for ALL survey sampling (every group AND custom filter): a reachable candidate is
  // roster-active (enforced by runFilter), has a WhatsApp number, is ATTENDING, and belongs to a
  // household whose registration is submitted. We never survey not-attending or unregistered people,
  // regardless of the chosen filter.
  const withContact = rows.filter((r) => r.whatsapp_e164 && r.mumin_id);
  const attending = withContact.filter((r) => r.not_attending !== true);
  const excludedNotAttending = withContact.length - attending.length;
  const reachable = attending.filter((r) => r.registration_status === "submitted");
  const excludedUnregistered = attending.length - reachable.length;

  // 2. Prior survey history (real sends only — is_test self/team links don't count): how many times
  // each mumin was sent, when last, whether sampled today, and how many they've completed.
  const { data: recipientRows } = await supabase
    .from("survey_recipients")
    .select("mumin_id, event_date, created_at, completed_at, is_test");
  const priorSends = new Map<string, number>();
  const completedCount = new Map<string, number>();
  const lastSentAt = new Map<string, string>();
  const sampledToday = new Set<string>();
  for (const r of (recipientRows ?? []) as { mumin_id: string | null; event_date: string | null; created_at: string; completed_at: string | null; is_test: boolean }[]) {
    if (!r.mumin_id || r.is_test) continue;
    priorSends.set(r.mumin_id, (priorSends.get(r.mumin_id) ?? 0) + 1);
    if (r.completed_at) completedCount.set(r.mumin_id, (completedCount.get(r.mumin_id) ?? 0) + 1);
    const prev = lastSentAt.get(r.mumin_id);
    if (!prev || r.created_at > prev) lastSentAt.set(r.mumin_id, r.created_at);
    if (r.event_date === eventDate) sampledToday.add(r.mumin_id);
  }

  // 3. Exposure to THIS form's questions: a candidate exposed to every question is exhausted.
  const exposedByMumin = new Map<string, Set<string>>();
  if (formQuestionIds.length > 0) {
    const { data: exposures } = await supabase
      .from("survey_question_exposures")
      .select("mumin_id, question_id")
      .in("question_id", formQuestionIds);
    for (const e of (exposures ?? []) as { mumin_id: string; question_id: string }[]) {
      let set = exposedByMumin.get(e.mumin_id);
      if (!set) exposedByMumin.set(e.mumin_id, (set = new Set()));
      set.add(e.question_id);
    }
  }
  const formQuestionSet = new Set(formQuestionIds);
  const isExhausted = (muminId: string): boolean => {
    if (formQuestionSet.size === 0) return false;
    const seen = exposedByMumin.get(muminId);
    if (!seen) return false;
    for (const qid of formQuestionSet) if (!seen.has(qid)) return false;
    return true;
  };

  // 4. Filter + rank.
  let excludedToday = 0;
  let excludedExhausted = 0;
  let excludedNonResponder = 0;
  let excludedAlreadySent = 0;
  const eligible: SampleCandidate[] = [];
  for (const r of reachable) {
    const id = r.mumin_id;
    if (sampledToday.has(id)) { excludedToday++; continue; }
    if (isExhausted(id)) { excludedExhausted++; continue; }
    // Opt-in: drop anyone who's already been sent ANY real survey this event, so a broad form
    // doesn't re-survey people a narrower one already reached (regardless of which questions).
    if (opts.excludeAlreadySent && (priorSends.get(id) ?? 0) > 0) { excludedAlreadySent++; continue; }
    // Stop bothering chronic non-responders: sent NON_RESPONDER_SEND_CAP+ times, never responded.
    if ((priorSends.get(id) ?? 0) >= NON_RESPONDER_SEND_CAP && (completedCount.get(id) ?? 0) === 0) { excludedNonResponder++; continue; }
    eligible.push({
      muminId: id,
      familyId: r.family_id,
      its: r.its,
      phone: r.whatsapp_e164 as string,
      fullName: r.full_name,
      gender: r.gender,
      priorSends: priorSends.get(id) ?? 0,
    });
  }

  eligible.sort((a, b) => {
    if (a.priorSends !== b.priorSends) return a.priorSends - b.priorSends; // fresh first
    const la = lastSentAt.get(a.muminId) ?? ""; // longest-since-last next ("" = never, sorts first)
    const lb = lastSentAt.get(b.muminId) ?? "";
    if (la !== lb) return la < lb ? -1 : 1;
    return a.muminId < b.muminId ? -1 : 1; // stable
  });

  const chosen = eligible.slice(0, Math.max(0, size));
  return {
    chosen,
    funnel: {
      candidates: reachable.length,
      excludedNotAttending,
      excludedUnregistered,
      excludedToday,
      excludedExhausted,
      excludedNonResponder,
      excludedAlreadySent,
      fresh: chosen.filter((c) => c.priorSends === 0).length,
      reused: chosen.filter((c) => c.priorSends > 0).length,
      chosen: chosen.length,
    },
  };
}

// Suggest which questions to include for a section: the section's active questions ordered by
// fewest prior exposures (so the databank rotates as the event progresses), capped at `k`.
export async function suggestQuestionsForSection(
  sectionId: string,
  k: number,
): Promise<Array<{ id: string; text: string; exposures: number }>> {
  const supabase = getSupabaseAdmin();
  const { data: questions } = await supabase
    .from("survey_questions")
    .select("id, text, sort_order")
    .eq("section_id", sectionId)
    .eq("active", true)
    .order("sort_order");
  const qs = (questions ?? []) as { id: string; text: string; sort_order: number }[];
  if (qs.length === 0) return [];

  const { data: exposures } = await supabase
    .from("survey_question_exposures")
    .select("question_id")
    .in("question_id", qs.map((q) => q.id));
  const counts = new Map<string, number>();
  for (const e of (exposures ?? []) as { question_id: string }[]) {
    counts.set(e.question_id, (counts.get(e.question_id) ?? 0) + 1);
  }

  return qs
    .map((q, i) => ({ id: q.id, text: q.text, exposures: counts.get(q.id) ?? 0, order: i }))
    .sort((a, b) => (a.exposures !== b.exposures ? a.exposures - b.exposures : a.order - b.order))
    .slice(0, Math.max(0, k))
    .map(({ id, text, exposures }) => ({ id, text, exposures }));
}
