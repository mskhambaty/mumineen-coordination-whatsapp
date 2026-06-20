import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the audience engine (candidate resolution) and Supabase (history + exposures).
const runFilter = vi.fn();
vi.mock("@/lib/whatsapp/audience-filter", () => ({ runFilter: (...a: unknown[]) => runFilter(...a) }));

let recipientRows: unknown[] = [];
let exposureRows: unknown[] = [];
let answerRows: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      // Paginated reads: .range(from,...) returns the rows on the first page, [] after (loop ends).
      if (table === "survey_recipients") {
        return { select: () => ({ range: (from: number) => Promise.resolve({ data: from === 0 ? recipientRows : [] }) }) };
      }
      if (table === "survey_question_exposures") {
        return { select: () => ({ in: () => ({ range: (from: number) => Promise.resolve({ data: from === 0 ? exposureRows : [] }) }) }) };
      }
      if (table === "survey_answers") {
        return { select: () => ({ in: () => ({ range: (from: number) => Promise.resolve({ data: from === 0 ? answerRows : [] }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { suggestSample, scalePlanToTotal } from "@/lib/surveys/sampling";

const RULES = { combinator: "and" as const, rules: [] };
const TODAY = "2026-06-16";
function row(id: string, extra: Record<string, unknown> = {}) {
  // registration_status defaults to "submitted" — survey sampling only targets registered households.
  return { mumin_id: id, family_id: null, whatsapp_e164: `+1555${id}`, full_name: `Name ${id}`, registration_status: "submitted", ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  recipientRows = [];
  exposureRows = [];
  answerRows = [];
});

describe("suggestSample", () => {
  it("excludes today's samples and question-exhausted mumineen; counts fresh per section", async () => {
    runFilter.mockResolvedValue([
      row("A"),                                  // never surveyed -> fresh for this section
      row("B"),                                  // surveyed another section before, NOT this one -> still fresh here
      row("C"),                                  // already sampled today -> excluded
      row("D"),                                  // exposed to every form question -> exhausted, excluded
      row("E2"),                                 // partially exposed to this form (q1 only) -> reused for this section
      { ...row("E"), whatsapp_e164: null },      // no phone -> not reachable
    ]);
    recipientRows = [
      { mumin_id: "B", event_date: "2026-06-14", created_at: "2026-06-14T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "C", event_date: TODAY, created_at: `${TODAY}T08:00:00Z`, completed_at: null, is_test: false },
    ];
    exposureRows = [
      { mumin_id: "D", question_id: "q1" },
      { mumin_id: "D", question_id: "q2" },
      { mumin_id: "E2", question_id: "q1" }, // partial → reused for this section
    ];

    const res = await suggestSample(RULES, ["q1", "q2"], 10, TODAY);

    const ids = res.chosen.map((c) => c.muminId).sort();
    expect(ids).toEqual(["A", "B", "E2"]); // A, B fresh-for-section + E2 partial; C/D excluded
    expect(res.funnel).toMatchObject({ candidates: 5, excludedToday: 1, excludedExhausted: 1, fresh: 2, reused: 1, chosen: 3 });
  });

  it("only samples registered households (excludes registration not_started)", async () => {
    runFilter.mockResolvedValue([
      row("A"),                                              // registered -> eligible
      { ...row("U"), registration_status: "not_started" },   // unregistered -> excluded
      { ...row("V"), registration_status: null },            // unregistered -> excluded
    ]);
    const res = await suggestSample(RULES, [], 10, TODAY);
    expect(res.chosen.map((c) => c.muminId)).toEqual(["A"]);
    expect(res.funnel).toMatchObject({ candidates: 1, excludedUnregistered: 2, chosen: 1 });
  });

  it("excludes not-attending people from every group/filter", async () => {
    runFilter.mockResolvedValue([
      row("A"),                                    // attending -> eligible
      { ...row("X"), not_attending: true },        // not attending -> excluded
    ]);
    const res = await suggestSample(RULES, [], 10, TODAY);
    expect(res.chosen.map((c) => c.muminId)).toEqual(["A"]);
    expect(res.funnel).toMatchObject({ candidates: 1, excludedNotAttending: 1, chosen: 1 });
  });

  it("resend-until-responded: excludes people who already ANSWERED, keeps non-responders", async () => {
    runFilter.mockResolvedValue([row("A"), row("B"), row("C")]);
    answerRows = [{ mumin_id: "A" }]; // A already responded
    // resend mode: no exhaustion (formQuestionIds empty), exclude responders via question ids
    const res = await suggestSample(RULES, [], 10, TODAY, { respondedExcludeQuestionIds: ["q1", "q2"] });
    const ids = res.chosen.map((c) => c.muminId).sort();
    expect(ids).toEqual(["B", "C"]); // A excluded (responded), B/C re-nudged
    expect(res.funnel.excludedResponded).toBe(1);
  });

  it("respects the sample size cap", async () => {
    runFilter.mockResolvedValue([row("A"), row("B"), row("C")]);
    const res = await suggestSample(RULES, [], 2, TODAY);
    expect(res.chosen).toHaveLength(2);
  });

  it("does not exclude on exposure when the form has no questions", async () => {
    runFilter.mockResolvedValue([row("A"), row("B")]);
    exposureRows = [{ mumin_id: "A", question_id: "q1" }];
    const res = await suggestSample(RULES, [], 10, TODAY);
    expect(res.chosen).toHaveLength(2);
  });

  it("drops chronic non-responders (NON_RESPONDER_SEND_CAP+ real sends, never responded) but keeps responders", async () => {
    runFilter.mockResolvedValue([row("A"), row("N"), row("Rsp")]);
    recipientRows = [
      // N: sent 5 times (>= cap of 5), never completed -> excluded.
      { mumin_id: "N", event_date: "2026-06-10", created_at: "2026-06-10T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "N", event_date: "2026-06-11", created_at: "2026-06-11T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "N", event_date: "2026-06-12", created_at: "2026-06-12T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "N", event_date: "2026-06-13", created_at: "2026-06-13T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "N", event_date: "2026-06-14", created_at: "2026-06-14T10:00:00Z", completed_at: null, is_test: false },
      // Rsp: sent many times but responded once -> still eligible.
      { mumin_id: "Rsp", event_date: "2026-06-10", created_at: "2026-06-10T10:00:00Z", completed_at: "2026-06-10T11:00:00Z", is_test: false },
      { mumin_id: "Rsp", event_date: "2026-06-11", created_at: "2026-06-11T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "Rsp", event_date: "2026-06-12", created_at: "2026-06-12T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "Rsp", event_date: "2026-06-13", created_at: "2026-06-13T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "Rsp", event_date: "2026-06-14", created_at: "2026-06-14T10:00:00Z", completed_at: null, is_test: false },
    ];
    const res = await suggestSample(RULES, [], 10, TODAY);
    const ids = res.chosen.map((c) => c.muminId);
    expect(ids).toContain("A");
    expect(ids).toContain("Rsp");
    expect(ids).not.toContain("N");
    expect(res.funnel.excludedNonResponder).toBe(1);
  });

  it("scalePlanToTotal: caps a plan to a total, preserving stratum ratio and summing exactly", () => {
    const rule = { combinator: "and" as const, rules: [] };
    const plan = [
      { label: "Local", rules: rule, size: 107 },
      { label: "Mehman", rules: rule, size: 51 },
    ];
    // Cap 158 → 25, ratio preserved (107:51 ≈ 2.1:1), sums to exactly 25.
    const scaled = scalePlanToTotal(plan, 25);
    expect(scaled.map((s) => s.size)).toEqual([17, 8]);
    expect(scaled.reduce((a, s) => a + s.size, 0)).toBe(25);
    // No-op when cap is >= plan total or non-positive.
    expect(scalePlanToTotal(plan, 158)).toEqual(plan);
    expect(scalePlanToTotal(plan, 999)).toEqual(plan);
    expect(scalePlanToTotal(plan, 0)).toEqual(plan);
  });

  it("ignores is_test sends when counting history", async () => {
    runFilter.mockResolvedValue([row("T")]);
    recipientRows = [
      { mumin_id: "T", event_date: "2026-06-12", created_at: "2026-06-12T10:00:00Z", completed_at: null, is_test: true },
      { mumin_id: "T", event_date: "2026-06-14", created_at: "2026-06-14T10:00:00Z", completed_at: null, is_test: true },
    ];
    const res = await suggestSample(RULES, [], 10, TODAY);
    // Two test sends shouldn't make T look like a non-responder, and T should rank as fresh.
    expect(res.chosen.map((c) => c.muminId)).toContain("T");
    expect(res.funnel.excludedNonResponder).toBe(0);
    expect(res.funnel.fresh).toBe(1);
  });
});
