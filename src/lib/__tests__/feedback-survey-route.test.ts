import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadFormForToken = vi.fn();
const recordSurveyResponse = vi.fn();
vi.mock("@/lib/surveys/respond", () => ({
  loadFormForToken: (...a: unknown[]) => loadFormForToken(...a),
  recordSurveyResponse: (...a: unknown[]) => recordSurveyResponse(...a),
}));

import { GET, POST } from "@/app/api/feedback-survey/[token]/route";

const TOKEN = "abcdefgh12345678";
const params = (token: string) => Promise.resolve({ token });
const QID = "11111111-1111-4111-8111-111111111111";

function postReq(body: unknown) {
  return new NextRequest(`http://localhost/api/feedback-survey/${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/feedback-survey/[token]", () => {
  it("404s a too-short token without hitting the DB", async () => {
    const res = await GET(new NextRequest("http://localhost/x"), { params: params("short") });
    expect(res.status).toBe(404);
    expect(loadFormForToken).not.toHaveBeenCalled();
  });

  it("404s an unknown token", async () => {
    loadFormForToken.mockResolvedValue({ status: "not_found" });
    const res = await GET(new NextRequest("http://localhost/x"), { params: params(TOKEN) });
    expect(res.status).toBe(404);
  });

  it("returns the form for a valid token", async () => {
    loadFormForToken.mockResolvedValue({ status: "ok", firstName: "Mufaddal", sections: [] });
    const res = await GET(new NextRequest("http://localhost/x"), { params: params(TOKEN) });
    expect(res.status).toBe(200);
    expect((await res.json()).firstName).toBe("Mufaddal");
  });
});

describe("POST /api/feedback-survey/[token]", () => {
  it("rejects an invalid body", async () => {
    const res = await POST(postReq({ answers: [] }), { params: params(TOKEN) });
    expect(res.status).toBe(400);
    expect(recordSurveyResponse).not.toHaveBeenCalled();
  });

  it("records a valid submission", async () => {
    recordSurveyResponse.mockResolvedValue({ recorded: 1 });
    const res = await POST(postReq({ answers: [{ question_id: QID, value: "Yes" }] }), { params: params(TOKEN) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: "ok", recorded: 1 });
    expect(recordSurveyResponse).toHaveBeenCalledWith(TOKEN, [{ question_id: QID, value: "Yes" }]);
  });

  it("surfaces an invalid-token error from the lib as 400", async () => {
    recordSurveyResponse.mockResolvedValue({ error: "Invalid or expired survey link." });
    const res = await POST(postReq({ answers: [{ question_id: QID, value: "No" }] }), { params: params(TOKEN) });
    expect(res.status).toBe(400);
  });
});
