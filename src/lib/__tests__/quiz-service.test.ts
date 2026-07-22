import { beforeEach, describe, expect, it, vi } from "vitest";

// Canned data the mocked Supabase returns, keyed by table. Tests mutate these before calling.
let recipientsList: unknown[] = []; // quiz_recipients.select(...).eq().eq() → list
let quizRow: unknown = { quiz_key: "ashara-1448h", is_open: true };
let existingRecipient: unknown = null; // quiz_recipients ... maybeSingle() (single-row lookups)
let muminRow: unknown = null;
const inserts: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      // Terminal value for list reads (await on the builder) vs single-row reads.
      const listResult = { data: table === "quiz_recipients" ? recipientsList : [], error: null };
      const singleResult =
        table === "quizzes"
          ? { data: quizRow, error: null }
          : table === "mumineen"
            ? { data: muminRow, error: null }
            : table === "quiz_recipients"
              ? { data: existingRecipient, error: null }
              : { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: () => chain,
        delete: () => chain,
        insert: (rows: unknown) => {
          (inserts[table] ||= []).push(rows);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: "new-rec" }, error: null }) }) };
        },
        eq: () => chain,
        maybeSingle: () => Promise.resolve(singleResult),
        single: () => Promise.resolve(singleResult),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(listResult).then(res, rej),
      };
      return chain;
    },
  }),
}));

import { getLeaderboard, recordSelfIdentified } from "@/lib/quiz/service";

beforeEach(() => {
  recipientsList = [];
  quizRow = { quiz_key: "ashara-1448h", is_open: true };
  existingRecipient = null;
  muminRow = null;
  for (const k of Object.keys(inserts)) delete inserts[k];
});

describe("getLeaderboard ordering", () => {
  it("ranks by score desc, then fastest time, then earliest completion", async () => {
    recipientsList = [
      { display_name: "Slow14", its_number: "1", score: 14, total: 15, status: "completed", completed_at: "2026-06-26T10:00:00Z", time_taken_seconds: 300, is_test: false },
      { display_name: "Fast14", its_number: "2", score: 14, total: 15, status: "completed", completed_at: "2026-06-26T11:00:00Z", time_taken_seconds: 120, is_test: false },
      { display_name: "Top15", its_number: "3", score: 15, total: 15, status: "completed", completed_at: "2026-06-26T12:00:00Z", time_taken_seconds: 400, is_test: false },
      { display_name: "Opened", its_number: "4", score: null, total: null, status: "opened", completed_at: null, time_taken_seconds: null, is_test: false },
    ];
    const { rows, summary } = await getLeaderboard();
    expect(rows.map((r) => r.name)).toEqual(["Top15", "Fast14", "Slow14"]); // 15 first; among 14s, faster first
    expect(summary.completed).toBe(3);
  });
});

describe("recordSelfIdentified", () => {
  const input = {
    share_token: "ashara-1448h-quiz",
    its_number: "30000001",
    name: "Husain",
    duration_seconds: 90,
    time_taken_seconds: 120,
    answers: [{ question_id: "q1", chosen_index: 0 }],
  };

  it("is idempotent — a completed ITS returns the saved score without inserting again", async () => {
    existingRecipient = { id: "r1", status: "completed", score: 13, total: 15 };
    const res = await recordSelfIdentified(input);
    expect(res).toMatchObject({ status: "completed", score: 13, total: 15 });
    expect(inserts.quiz_recipients).toBeUndefined();
  });

  it("rejects a closed quiz", async () => {
    quizRow = { quiz_key: "ashara-1448h", is_open: false };
    const res = await recordSelfIdentified(input);
    expect("error" in res).toBe(true);
  });

  it("creates a new attempt for a first-time ITS", async () => {
    existingRecipient = null;
    const res = await recordSelfIdentified(input);
    expect(res).toMatchObject({ status: "completed" });
    expect(inserts.quiz_recipients?.length).toBe(1);
  });
});
