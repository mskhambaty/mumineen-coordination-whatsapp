import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadQuizForToken: vi.fn(),
  recordQuizResponse: vi.fn(),
  recordSelfIdentified: vi.fn(),
}));

vi.mock("@/lib/quiz/service", () => ({
  loadQuizForToken: (...a: unknown[]) => mocks.loadQuizForToken(...a),
  recordQuizResponse: (...a: unknown[]) => mocks.recordQuizResponse(...a),
  recordSelfIdentified: (...a: unknown[]) => mocks.recordSelfIdentified(...a),
}));

import { GET, POST } from "@/app/api/quiz/[token]/route";

const params = (token: string) => ({ params: Promise.resolve({ token }) });
const req = (body?: unknown) => ({ json: async () => body }) as unknown as Parameters<typeof POST>[0];

beforeEach(() => vi.clearAllMocks());

describe("GET /api/quiz/[token]", () => {
  it("404s a too-short token without hitting the service", async () => {
    const res = await GET(req(), params("short"));
    expect(res.status).toBe(404);
    expect(mocks.loadQuizForToken).not.toHaveBeenCalled();
  });

  it("returns the quiz (with requires_identity for a shared link)", async () => {
    mocks.loadQuizForToken.mockResolvedValue({ status: "ok", quiz_key: "ashara-1448h", title_en: "t", title_ld: "t", first_name: null, questions: [], requires_identity: true });
    const res = await GET(req(), params("ashara-1448h-quiz"));
    expect(res.status).toBe(200);
    expect((await res.json()).requires_identity).toBe(true);
  });
});

describe("POST /api/quiz/[token] — shared-link self-identified submit", () => {
  const goodBody = {
    its_number: "30000001",
    name: "Husain",
    duration_seconds: 90,
    time_taken_seconds: 120,
    answers: [{ question_id: "q1", chosen_index: 0 }],
  };

  it("records a valid self-identified submission", async () => {
    mocks.recordSelfIdentified.mockResolvedValue({ status: "completed", score: 12, total: 15, answers: [] });
    const res = await POST(req(goodBody), params("ashara-1448h-quiz"));
    expect(res.status).toBe(200);
    expect(mocks.recordSelfIdentified).toHaveBeenCalledWith(expect.objectContaining({ share_token: "ashara-1448h-quiz", its_number: "30000001", name: "Husain" }));
    expect(mocks.recordQuizResponse).not.toHaveBeenCalled();
  });

  it("rejects a non-8-digit ITS with 400", async () => {
    const res = await POST(req({ ...goodBody, its_number: "123" }), params("ashara-1448h-quiz"));
    expect(res.status).toBe(400);
    expect(mocks.recordSelfIdentified).not.toHaveBeenCalled();
  });

  it("rejects an empty name with 400", async () => {
    const res = await POST(req({ ...goodBody, name: "  " }), params("ashara-1448h-quiz"));
    expect(res.status).toBe(400);
    expect(mocks.recordSelfIdentified).not.toHaveBeenCalled();
  });
});

describe("POST /api/quiz/[token] — recipient (test-link) submit", () => {
  it("uses recordQuizResponse when no ITS is present", async () => {
    mocks.recordQuizResponse.mockResolvedValue({ status: "completed", score: 3, total: 15, answers: [] });
    const res = await POST(req({ answers: [{ question_id: "q1", chosen_index: 1 }] }), params("recipienttoken123"));
    expect(res.status).toBe(200);
    expect(mocks.recordQuizResponse).toHaveBeenCalled();
    expect(mocks.recordSelfIdentified).not.toHaveBeenCalled();
  });

  it("400s an empty answers array", async () => {
    const res = await POST(req({ answers: [] }), params("recipienttoken123"));
    expect(res.status).toBe(400);
  });
});
