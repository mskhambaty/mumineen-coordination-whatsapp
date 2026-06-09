import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveFamilyForPhone = vi.fn();
const getFamilyNiyazGrid = vi.fn();
const setFamilyNiyazRsvp = vi.fn();

vi.mock("@/lib/rsvp/family", () => ({
  resolveFamilyForPhone: (...args: unknown[]) => resolveFamilyForPhone(...args),
}));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({
  getFamilyNiyazGrid: (...args: unknown[]) => getFamilyNiyazGrid(...args),
  setFamilyNiyazRsvp: (...args: unknown[]) => setFamilyNiyazRsvp(...args),
}));

import { GET, POST } from "@/app/api/rsvp/meals/route";

const PHONE = "+15551234567";
const FAMILY = { familyId: "fam-1", muminId: "m-1", hofIts: "10", displayName: "X" };

function req(method: string, body?: unknown, withPhone = true): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withPhone) headers["x-whatsapp-from"] = PHONE;
  return new NextRequest("http://localhost/api/rsvp/meals", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/rsvp/meals", () => {
  it("rejects a request with no x-whatsapp-from header (unauthorized)", async () => {
    const res = await GET(req("GET", undefined, false));
    expect(res.status).toBe(400);
    expect(resolveFamilyForPhone).not.toHaveBeenCalled();
  });

  it("returns the caller's family grid", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    getFamilyNiyazGrid.mockResolvedValue([{ event: { id: "e1" }, attending: 4, total: 5 }]);
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.grid).toHaveLength(1);
    expect(getFamilyNiyazGrid).toHaveBeenCalledWith("fam-1");
  });

  it("returns no_family when the number isn't on the roster", async () => {
    resolveFamilyForPhone.mockResolvedValue(null);
    const res = await GET(req("GET"));
    expect((await res.json()).status).toBe("no_family");
    expect(getFamilyNiyazGrid).not.toHaveBeenCalled();
  });
});

describe("POST /api/rsvp/meals", () => {
  it("rejects with no x-whatsapp-from header", async () => {
    const res = await POST(req("POST", { entries: [{ attending: false, dates: ["2026-06-16"] }] }, false));
    expect(res.status).toBe(400);
    expect(setFamilyNiyazRsvp).not.toHaveBeenCalled();
  });

  it("rejects an invalid body (entry missing attending)", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    const res = await POST(req("POST", { entries: [{ dates: ["2026-06-16"] }] }));
    expect(res.status).toBe(400);
    expect(setFamilyNiyazRsvp).not.toHaveBeenCalled();
  });

  it("returns no_family when the number isn't on the roster", async () => {
    resolveFamilyForPhone.mockResolvedValue(null);
    const res = await POST(req("POST", { entries: [{ attending: false, dates: ["2026-06-16"] }] }));
    expect((await res.json()).status).toBe("no_family");
    expect(setFamilyNiyazRsvp).not.toHaveBeenCalled();
  });

  it("applies a 'no for a date' change for the whole family", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    setFamilyNiyazRsvp.mockResolvedValue({ updated: 5, grid: [] });
    const res = await POST(req("POST", { entries: [{ attending: false, dates: ["2026-06-16"] }] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.updated).toBe(5);
    expect(setFamilyNiyazRsvp).toHaveBeenCalledWith(
      "fam-1",
      [{ attending: false, dates: ["2026-06-16"], meal: undefined, all: undefined }],
      { source: "whatsapp", phone: PHONE },
    );
  });
});
