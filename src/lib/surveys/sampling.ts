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
  priorSends: number; // how many surveys they've previously been sent (any form — drives non-responder cap)
  seenThisForm: number; // how many of THIS form's tracked questions they've already been asked (0 = fresh for this section)
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
    excludedResponded: number; // resend-until-responded: already ANSWERED this form's questions
    excludedAlreadySent: number; // opt-in: already sent ANY survey this event (cross-form de-overlap)
    fresh: number; // of chosen, never asked THIS form's section before (new to this section)
    reused: number; // of chosen, partially asked this section before (fully-asked are excluded as exhausted)
    chosen: number;
  };
};

// Stop including someone once they've been SENT this many real surveys without ever responding.
// Set to 5 (was 2): a low cap shrank the usable daily pool too aggressively — especially after the
// 6/18 duplicate-send incident inflated send counts — benching people who'd effectively had one real ask.
export const NON_RESPONDER_SEND_CAP = 5;

// Section ids flagged dedup_exempt (Seating, Overall Experience, …) — their questions ride along on
// many forms and are NOT tracked for exposure/exhaustion, so they don't distort the fresh-sample set.
export async function dedupExemptSectionIds(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<Set<string>> {
  const { data } = await supabase.from("survey_sections").select("id").eq("dedup_exempt", true);
  return new Set(((data ?? []) as { id: string }[]).map((s) => s.id));
}

// Suggest a sample of up to `size` mumineen for a form targeting `groupRules`, given the form's
// question ids (for once-per-event dedup). Ranking: fresh-first (never-surveyed before reused), then
// RANDOM within each freshness tier — so selection is fair and non-deterministic across days.
export async function suggestSample(
  groupRules: RuleGroup,
  formQuestionIds: string[],
  size: number,
  eventDate: string = chicagoToday(),
  opts: { freeWindowOnly?: boolean; windowHours?: number; excludeAlreadySent?: boolean; respondedExcludeQuestionIds?: string[] } = {},
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
  // each mumin was sent, whether sampled today, and how many they've completed. MUST paginate — a
  // single PostgREST read caps at 1000 rows, and a truncated history silently breaks the
  // "already sampled today" / once-per-day guarantee once the table grows past 1000.
  const recipientRows: { mumin_id: string | null; event_date: string | null; completed_at: string | null; is_test: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("survey_recipients")
      .select("mumin_id, event_date, completed_at, is_test")
      .range(from, from + 999);
    if (error) break;
    recipientRows.push(...((data ?? []) as typeof recipientRows));
    if (!data || data.length < 1000) break;
  }
  const priorSends = new Map<string, number>();
  const completedCount = new Map<string, number>();
  const sampledToday = new Set<string>();
  for (const r of recipientRows) {
    if (!r.mumin_id || r.is_test) continue;
    priorSends.set(r.mumin_id, (priorSends.get(r.mumin_id) ?? 0) + 1);
    if (r.completed_at) completedCount.set(r.mumin_id, (completedCount.get(r.mumin_id) ?? 0) + 1);
    if (r.event_date === eventDate) sampledToday.add(r.mumin_id);
  }

  // 3. Exposure to THIS form's questions: a candidate exposed to every question is exhausted.
  // Paginate (1000-row cap) — a popular question accumulates many exposures across forms.
  const exposedByMumin = new Map<string, Set<string>>();
  if (formQuestionIds.length > 0) {
    const exposures: { mumin_id: string; question_id: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("survey_question_exposures")
        .select("mumin_id, question_id")
        .in("question_id", formQuestionIds)
        .range(from, from + 999);
      if (error) break;
      exposures.push(...((data ?? []) as typeof exposures));
      if (!data || data.length < 1000) break;
    }
    for (const e of exposures) {
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

  // 3b. Resend-until-responded: mumineen who have ALREADY ANSWERED any of these questions are
  // excluded (they've given feedback); non-responders stay eligible to be re-nudged.
  const respondedSet = new Set<string>();
  if (opts.respondedExcludeQuestionIds?.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("survey_answers")
        .select("mumin_id")
        .in("question_id", opts.respondedExcludeQuestionIds)
        .range(from, from + 999);
      if (error) break;
      for (const a of (data ?? []) as { mumin_id: string | null }[]) if (a.mumin_id) respondedSet.add(a.mumin_id);
      if (!data || data.length < 1000) break;
    }
  }

  // 4. Filter + rank.
  let excludedToday = 0;
  let excludedExhausted = 0;
  let excludedNonResponder = 0;
  let excludedResponded = 0;
  let excludedAlreadySent = 0;
  const eligible: SampleCandidate[] = [];
  for (const r of reachable) {
    const id = r.mumin_id;
    if (sampledToday.has(id)) { excludedToday++; continue; }
    if (respondedSet.has(id)) { excludedResponded++; continue; }
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
      seenThisForm: exposedByMumin.get(id)?.size ?? 0, // how many of this form's tracked questions they've seen
    });
  }

  // Rank fresh-FOR-THIS-SECTION first (people who haven't seen any of this form's tracked questions
  // before those who've partially seen it — coverage spreads per section), then RANDOMIZE within
  // each tier so selection is fair and non-deterministic. Someone who did OTHER sections counts as
  // fresh here; only this form's own questions matter.
  const rnd = new Map<string, number>();
  for (const c of eligible) rnd.set(c.muminId, Math.random());
  eligible.sort((a, b) => {
    if (a.seenThisForm !== b.seenThisForm) return a.seenThisForm - b.seenThisForm; // section-fresh first
    return (rnd.get(a.muminId) ?? 0) - (rnd.get(b.muminId) ?? 0); // random within the tier
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
      excludedResponded,
      excludedAlreadySent,
      fresh: chosen.filter((c) => c.seenThisForm === 0).length,
      reused: chosen.filter((c) => c.seenThisForm > 0).length,
      chosen: chosen.length,
    },
  };
}

// One stratum of a stratified plan: its own audience filter + quota (e.g. Local → 107, Mehman → 70).
export type Stratum = { label: string; rules: RuleGroup; size: number };

// Scale a plan's per-stratum quotas down so they sum to `totalCap`, preserving each stratum's share
// of the original total (largest-remainder rounding → the scaled sizes sum to exactly `totalCap`).
// Only ever scales DOWN: a cap >= the plan total (or <= 0) leaves the plan untouched.
export function scalePlanToTotal(plan: Stratum[], totalCap: number): Stratum[] {
  const planTotal = plan.reduce((sum, s) => sum + s.size, 0);
  if (!totalCap || totalCap <= 0 || totalCap >= planTotal || planTotal <= 0) return plan;
  const rows = plan.map((s, i) => {
    const exact = (s.size * totalCap) / planTotal;
    const base = Math.floor(exact);
    return { i, base, rem: exact - base };
  });
  let remaining = totalCap - rows.reduce((sum, r) => sum + r.base, 0);
  // Hand out the leftover units to the strata with the largest fractional remainder.
  [...rows].sort((a, b) => b.rem - a.rem).forEach((r) => { if (remaining > 0) { r.base += 1; remaining -= 1; } });
  return plan.map((s, i) => ({ ...s, size: rows[i].base }));
}

// Stratified sampling: sample each stratum from its own pool, then COMBINE into one set, deduping by
// phone/mumin across strata (so a person picked in one stratum isn't double-counted in another). The
// per-form `sampledToday` exclusion still applies globally, so sending several plan-forms in sequence
// partitions the day's audience (one survey per person per day). Returns a SampleResult plus a
// per-stratum breakdown for the preview.
export async function suggestSamplePlan(
  plan: Stratum[],
  formQuestionIds: string[],
  eventDate: string = chicagoToday(),
  opts: { freeWindowOnly?: boolean; windowHours?: number; excludeAlreadySent?: boolean; respondedExcludeQuestionIds?: string[]; totalCap?: number } = {},
): Promise<SampleResult & { strata: Array<{ label: string; requested: number; got: number; candidates: number }> }> {
  // A non-zero totalCap (the form's sample_size) caps the whole plan, scaling strata proportionally.
  plan = scalePlanToTotal(plan, opts.totalCap ?? 0);
  const chosen: SampleCandidate[] = [];
  const seenPhone = new Set<string>();
  const seenMumin = new Set<string>();
  const strata: Array<{ label: string; requested: number; got: number; candidates: number }> = [];
  const funnel: SampleResult["funnel"] = {
    candidates: 0, excludedNotAttending: 0, excludedUnregistered: 0, excludedToday: 0,
    excludedExhausted: 0, excludedNonResponder: 0, excludedResponded: 0, excludedAlreadySent: 0, fresh: 0, reused: 0, chosen: 0,
  };
  for (const s of plan) {
    // Over-fetch a little so cross-stratum dedup can't leave us short of the quota.
    const res = await suggestSample(s.rules, formQuestionIds, s.size + seenPhone.size, eventDate, opts);
    const picks = res.chosen.filter((c) => !seenPhone.has(c.phone) && !seenMumin.has(c.muminId)).slice(0, Math.max(0, s.size));
    for (const c of picks) { seenPhone.add(c.phone); seenMumin.add(c.muminId); chosen.push(c); }
    strata.push({ label: s.label, requested: s.size, got: picks.length, candidates: res.funnel.candidates });
    funnel.candidates += res.funnel.candidates;
    funnel.excludedNotAttending += res.funnel.excludedNotAttending;
    funnel.excludedUnregistered += res.funnel.excludedUnregistered;
    funnel.excludedToday += res.funnel.excludedToday;
    funnel.excludedExhausted += res.funnel.excludedExhausted;
    funnel.excludedNonResponder += res.funnel.excludedNonResponder;
    funnel.excludedResponded += res.funnel.excludedResponded;
    funnel.excludedAlreadySent += res.funnel.excludedAlreadySent;
  }
  funnel.fresh = chosen.filter((c) => c.seenThisForm === 0).length;
  funnel.reused = chosen.filter((c) => c.seenThisForm > 0).length;
  funnel.chosen = chosen.length;
  return { chosen, funnel, strata };
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
