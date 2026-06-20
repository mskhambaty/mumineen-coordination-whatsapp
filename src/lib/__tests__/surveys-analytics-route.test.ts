import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Auth always passes (admin caller).
vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: async () => ({ id: "admin" }) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));

// Canned tables; each test sets these before calling the route.
let recipientRows: Record<string, unknown>[] = [];
let answerRows: Record<string, unknown>[] = [];
let muminRows: Record<string, unknown>[] = [];
let formRows: Record<string, unknown>[] = [];

// Minimal PostgREST builder: chainable + thenable. Paginated tables return [] past the first page.
function builder(table: string) {
  let rangeFrom: number | null = null;
  const data = () => {
    if ((table === "survey_recipients" || table === "survey_answers") && rangeFrom && rangeFrom > 0) return [];
    if (table === "survey_recipients") return recipientRows;
    if (table === "survey_answers") return answerRows;
    if (table === "mumineen") return muminRows;
    if (table === "survey_forms") return formRows;
    if (table === "survey_sections") return [];
    if (table === "survey_questions") return [];
    return [];
  };
  const b: Record<string, unknown> = {};
  const ret = () => b;
  b.select = ret; b.order = ret; b.in = ret;
  b.range = (from: number) => { rangeFrom = from; return b; };
  b.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: data(), error: null });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));

import { POST } from "@/app/api/admin/surveys/analytics/route";

const FORM = "11111111-1111-1111-1111-111111111111";
function post(body: unknown) {
  return POST(new NextRequest("http://t/api/admin/surveys/analytics", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  formRows = [{ id: FORM, title: "Daily", status: "sent", tags: [], event_date: "2026-06-19", sent_at: null, group_id: null, rules: null }];
  muminRows = ["A", "B", "C", "D", "E"].map((id) => ({ id, full_name: id, its: id, age: 30, gender: "M", local_mehman: "Local", rahat_seating: false, wheelchair: false, jamaat: null, category: null }));
  // 3 recipients sent 6/19 (A,B completed; C sent), 2 sent 6/18 (D completed; E sent).
  recipientRows = [
    { id: "rA", form_id: FORM, mumin_id: "A", status: "completed", is_test: false, event_date: "2026-06-19" },
    { id: "rB", form_id: FORM, mumin_id: "B", status: "completed", is_test: false, event_date: "2026-06-19" },
    { id: "rC", form_id: FORM, mumin_id: "C", status: "sent", is_test: false, event_date: "2026-06-19" },
    { id: "rD", form_id: FORM, mumin_id: "D", status: "completed", is_test: false, event_date: "2026-06-18" },
    { id: "rE", form_id: FORM, mumin_id: "E", status: "sent", is_test: false, event_date: "2026-06-18" },
  ];
  answerRows = [
    { recipient_id: "rA", form_id: FORM, mumin_id: "A", section_id: null, question_id: null, area: null, answer_text: "x", reason_text: null, sentiment_1_5: 5, event_date: "2026-06-19", created_at: "2026-06-19T10:00:00Z" },
    { recipient_id: "rB", form_id: FORM, mumin_id: "B", section_id: null, question_id: null, area: null, answer_text: "y", reason_text: null, sentiment_1_5: 4, event_date: "2026-06-19", created_at: "2026-06-19T10:00:00Z" },
    { recipient_id: "rD", form_id: FORM, mumin_id: "D", section_id: null, question_id: null, area: null, answer_text: "z", reason_text: null, sentiment_1_5: 3, event_date: "2026-06-18", created_at: "2026-06-18T10:00:00Z" },
  ];
});

describe("surveys analytics route — date range", () => {
  it("overview cards respect the send-date range (not all-time)", async () => {
    const res = await post({ dateFrom: "2026-06-19", dateTo: "2026-06-19" });
    const json = await res.json();
    // Only the 3 recipients sent on 6/19 count — the 6/18 pair (D,E) is excluded.
    expect(json.overview.sent).toBe(3);
    expect(json.overview.responded).toBe(2); // A, B
    expect(json.overview.scored_answers).toBe(2); // only 6/19 answers
  });

  it("with no date range, overview is all-time", async () => {
    const res = await post({});
    const json = await res.json();
    expect(json.overview.sent).toBe(5);
    expect(json.overview.responded).toBe(3); // A, B, D
    expect(json.overview.scored_answers).toBe(3);
  });
});
