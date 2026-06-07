import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordFeedback = vi.fn();

vi.mock("@/lib/feedback/record", () => ({
  recordFeedback: (...args: unknown[]) => recordFeedback(...args),
}));

import { POST } from "@/app/api/feedback/route";

const PHONE = "+15551234567";

function req(body?: unknown, withPhone = true): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withPhone) headers["x-whatsapp-from"] = PHONE;
  return new NextRequest("http://localhost/api/feedback", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/feedback", () => {
  it("rejects with no x-whatsapp-from header (unauthorized)", async () => {
    const res = await req({ entries: [{ area: "mawaid" }] }, false);
    const out = await POST(res);
    expect(out.status).toBe(400);
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it("rejects an invalid area", async () => {
    const out = await POST(req({ entries: [{ area: "weather" }] }));
    expect(out.status).toBe(400);
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it("records valid multi-area feedback", async () => {
    recordFeedback.mockResolvedValue({ recorded: 2 });
    const out = await POST(
      req({
        entries: [
          { area: "mawaid", sentiment: "positive", comment: "Great thaal" },
          { area: "parking_transport", sentiment: "negative", rating: 2 },
        ],
      }),
    );
    expect(out.status).toBe(200);
    const json = await out.json();
    expect(json.recorded).toBe(2);
    expect(recordFeedback).toHaveBeenCalledWith(
      PHONE,
      [
        { area: "mawaid", sentiment: "positive", rating: null, comment: "Great thaal", rawMessage: null },
        { area: "parking_transport", sentiment: "negative", rating: 2, comment: null, rawMessage: null },
      ],
      { source: "whatsapp" },
    );
  });
});
