import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requirePortalCaller: vi.fn(), getLeaderboard: vi.fn(), createQuizRecipient: vi.fn(), getQuizShare: vi.fn(), setQuizOpen: vi.fn() }));

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => mocks.requirePortalCaller(...a) }));
vi.mock("@/lib/quiz/service", () => ({
  getLeaderboard: (...a: unknown[]) => mocks.getLeaderboard(...a),
  createQuizRecipient: (...a: unknown[]) => mocks.createQuizRecipient(...a),
  getQuizShare: (...a: unknown[]) => mocks.getQuizShare(...a),
  setQuizOpen: (...a: unknown[]) => mocks.setQuizOpen(...a),
}));

import { GET } from "@/app/api/admin/quiz/results/route";
import { POST as testLinkPOST } from "@/app/api/admin/quiz/test-link/route";
import { GET as shareGET, POST as sharePOST } from "@/app/api/admin/quiz/share/route";

const req = (body?: unknown) =>
  ({ json: async () => body ?? {} }) as unknown as Parameters<typeof GET>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePortalCaller.mockResolvedValue({ caller: { portal: { role: "admin" } } });
});

describe("GET /api/admin/quiz/results", () => {
  it("returns the leaderboard for an authorized caller", async () => {
    mocks.getLeaderboard.mockResolvedValue({ rows: [{ name: "Ali", score: 14, total: 15, completed_at: "x" }], summary: { sent: 5, completed: 3, avg_score: 12.3, total: 15 } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.completed).toBe(3);
    expect(body.rows[0].name).toBe("Ali");
  });

  it("denies an unauthorized caller (403 short-circuit, never reads data)", async () => {
    mocks.requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mocks.getLeaderboard).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/quiz/test-link", () => {
  it("mints a test link for an authorized caller", async () => {
    mocks.createQuizRecipient.mockResolvedValue({ token: "tok", link: "https://x/quiz/tok" });
    const res = await testLinkPOST(req({ display_name: "Tester" }));
    expect(res.status).toBe(200);
    expect((await res.json()).link).toContain("/quiz/");
    expect(mocks.createQuizRecipient).toHaveBeenCalledWith(expect.objectContaining({ is_test: true }));
  });

  it("denies an unauthorized caller", async () => {
    mocks.requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const res = await testLinkPOST(req());
    expect(res.status).toBe(403);
    expect(mocks.createQuizRecipient).not.toHaveBeenCalled();
  });
});

describe("admin quiz share route", () => {
  it("returns the shared link for an authorized caller", async () => {
    mocks.getQuizShare.mockResolvedValue({ share_token: "ashara-1448h-quiz", is_open: true, link: "https://x/quiz/ashara-1448h-quiz" });
    const res = await shareGET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).link).toContain("/quiz/");
  });

  it("toggles open state for an authorized caller", async () => {
    mocks.setQuizOpen.mockResolvedValue(undefined);
    mocks.getQuizShare.mockResolvedValue({ share_token: "ashara-1448h-quiz", is_open: false, link: "https://x/quiz/ashara-1448h-quiz" });
    const res = await sharePOST(req({ is_open: false }));
    expect(res.status).toBe(200);
    expect(mocks.setQuizOpen).toHaveBeenCalledWith(false);
    expect((await res.json()).is_open).toBe(false);
  });

  it("denies an unauthorized caller (no toggle)", async () => {
    mocks.requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const res = await sharePOST(req({ is_open: false }));
    expect(res.status).toBe(403);
    expect(mocks.setQuizOpen).not.toHaveBeenCalled();
  });
});
