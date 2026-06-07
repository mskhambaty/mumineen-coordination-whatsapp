import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveFamilyForPhone = vi.fn();
const getFamilyMealGrid = vi.fn();
const applyMealRsvps = vi.fn();

vi.mock("@/lib/rsvp/family", () => ({
  resolveFamilyForPhone: (...args: unknown[]) => resolveFamilyForPhone(...args),
}));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({
  getFamilyMealGrid: (...args: unknown[]) => getFamilyMealGrid(...args),
  applyMealRsvps: (...args: unknown[]) => applyMealRsvps(...args),
}));

import { GET, POST } from "@/app/api/rsvp/meals/route";

const PHONE = "+15551234567";

function req(method: string, body?: unknown, withPhone = true): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withPhone) headers["x-whatsapp-from"] = PHONE;
  return new NextRequest("http://localhost/api/rsvp/meals", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rsvp/meals", () => {
  it("rejects a request with no x-whatsapp-from header (unauthorized)", async () => {
    const res = await GET(req("GET", undefined, false));
    expect(res.status).toBe(400);
    expect(resolveFamilyForPhone).not.toHaveBeenCalled();
  });

  it("returns the caller's family grid", async () => {
    resolveFamilyForPhone.mockResolvedValue({ familyId: "fam-1", muminId: "m-1", hofIts: "10", displayName: "X" });
    getFamilyMealGrid.mockResolvedValue([{ eventDate: "2026-06-15", meal: "lunch", attending: true, headCount: 5 }]);
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.grid).toHaveLength(1);
    expect(getFamilyMealGrid).toHaveBeenCalledWith("fam-1");
  });

  it("returns no_family when the number isn't on the roster", async () => {
    resolveFamilyForPhone.mockResolvedValue(null);
    const res = await GET(req("GET"));
    const json = await res.json();
    expect(json.status).toBe("no_family");
    expect(getFamilyMealGrid).not.toHaveBeenCalled();
  });
});

describe("POST /api/rsvp/meals", () => {
  it("rejects with no x-whatsapp-from header", async () => {
    const res = await POST(req("POST", { entries: [{ meal: "lunch", attending: true }] }, false));
    expect(res.status).toBe(400);
    expect(applyMealRsvps).not.toHaveBeenCalled();
  });

  it("rejects an invalid body (bad meal)", async () => {
    const res = await POST(req("POST", { entries: [{ meal: "brunch", attending: true }] }));
    expect(res.status).toBe(400);
    expect(applyMealRsvps).not.toHaveBeenCalled();
  });

  it("applies valid entries and returns the updated grid", async () => {
    applyMealRsvps.mockResolvedValue({ updated: 10, grid: [] });
    const res = await POST(req("POST", { entries: [{ meal: "lunch", attending: true, head_count: 5, all: true }] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(10);
    expect(applyMealRsvps).toHaveBeenCalledWith(
      PHONE,
      [{ meal: "lunch", attending: true, headCount: 5, dates: undefined, all: true }],
      { source: "whatsapp" },
    );
  });
});
