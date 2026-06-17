import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the audience engine (candidate resolution) and Supabase (history + exposures).
const runFilter = vi.fn();
vi.mock("@/lib/whatsapp/audience-filter", () => ({ runFilter: (...a: unknown[]) => runFilter(...a) }));

let recipientRows: unknown[] = [];
let exposureRows: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      if (table === "survey_recipients") {
        return { select: () => Promise.resolve({ data: recipientRows }) };
      }
      if (table === "survey_question_exposures") {
        return { select: () => ({ in: () => Promise.resolve({ data: exposureRows }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { suggestSample } from "@/lib/surveys/sampling";

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
});

describe("suggestSample", () => {
  it("prefers fresh people, excludes today's samples and question-exhausted mumineen", async () => {
    runFilter.mockResolvedValue([
      row("A"),                                  // fresh
      row("B"),                                  // surveyed once before (reused)
      row("C"),                                  // already sampled today -> excluded
      row("D"),                                  // exposed to every form question -> excluded
      { ...row("E"), whatsapp_e164: null },      // no phone -> not reachable
    ]);
    recipientRows = [
      { mumin_id: "B", event_date: "2026-06-14", created_at: "2026-06-14T10:00:00Z" },
      { mumin_id: "C", event_date: TODAY, created_at: `${TODAY}T08:00:00Z` },
    ];
    exposureRows = [
      { mumin_id: "D", question_id: "q1" },
      { mumin_id: "D", question_id: "q2" },
    ];

    const res = await suggestSample(RULES, ["q1", "q2"], 10, TODAY);

    expect(res.chosen.map((c) => c.muminId)).toEqual(["A", "B"]); // fresh A before reused B
    expect(res.funnel).toMatchObject({ candidates: 4, excludedToday: 1, excludedExhausted: 1, fresh: 1, reused: 1, chosen: 2 });
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

  it("drops chronic non-responders (2+ real sends, never responded) but keeps responders", async () => {
    runFilter.mockResolvedValue([row("A"), row("N"), row("Rsp")]);
    recipientRows = [
      // N: sent twice, never completed -> excluded.
      { mumin_id: "N", event_date: "2026-06-12", created_at: "2026-06-12T10:00:00Z", completed_at: null, is_test: false },
      { mumin_id: "N", event_date: "2026-06-14", created_at: "2026-06-14T10:00:00Z", completed_at: null, is_test: false },
      // Rsp: sent twice but responded once -> still eligible.
      { mumin_id: "Rsp", event_date: "2026-06-12", created_at: "2026-06-12T10:00:00Z", completed_at: "2026-06-12T11:00:00Z", is_test: false },
      { mumin_id: "Rsp", event_date: "2026-06-14", created_at: "2026-06-14T10:00:00Z", completed_at: null, is_test: false },
    ];
    const res = await suggestSample(RULES, [], 10, TODAY);
    const ids = res.chosen.map((c) => c.muminId);
    expect(ids).toContain("A");
    expect(ids).toContain("Rsp");
    expect(ids).not.toContain("N");
    expect(res.funnel.excludedNonResponder).toBe(1);
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
