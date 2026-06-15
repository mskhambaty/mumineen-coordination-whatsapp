import { beforeEach, describe, expect, it, vi } from "vitest";

const getFamilyByHofIts = vi.fn();
const recordNiyazDayRsvp = vi.fn(async () => undefined);
const getEventConfigByDayId = vi.fn();

vi.mock("@/lib/rsvp/meal-rsvp", () => ({
  getFamilyByHofIts: (...a: unknown[]) => getFamilyByHofIts(...a),
  recordNiyazDayRsvp: (...a: unknown[]) => recordNiyazDayRsvp(...a),
}));
vi.mock("@/lib/rsvp/event-config", () => ({
  getEventConfigByDayId: (...a: unknown[]) => getEventConfigByDayId(...a),
}));

import { parseCount, recordNiyazRsvpFromInteractive } from "@/lib/rsvp/niyaz-interactive";

beforeEach(() => {
  vi.clearAllMocks();
  getFamilyByHofIts.mockResolvedValue({ familyId: "fam-1", hofIts: "40495151" });
  getEventConfigByDayId.mockResolvedValue({ eventDate: "2026-06-16", dayId: 2 });
});

describe("parseCount", () => {
  it("parses string/number counts; non-positive/invalid → 0", () => {
    expect(parseCount("2")).toBe(2);
    expect(parseCount(3)).toBe(3);
    expect(parseCount("0")).toBe(0);
    expect(parseCount(undefined)).toBe(0);
    expect(parseCount("abc")).toBe(0);
  });
});

describe("recordNiyazRsvpFromInteractive", () => {
  it("resolves family + day and records the per-meal counts", async () => {
    const ok = await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 2, lunchCount: 2, dinnerCount: 3, phone: "+1555" });
    expect(ok).toBe(true);
    expect(recordNiyazDayRsvp).toHaveBeenCalledWith("fam-1", "40495151", "2026-06-16", 2, 3, "+1555");
  });

  it("is a no-op (false) when the family can't be resolved", async () => {
    getFamilyByHofIts.mockResolvedValue(null);
    const ok = await recordNiyazRsvpFromInteractive({ hofIts: "999", dayId: 2, lunchCount: 1, dinnerCount: 1 });
    expect(ok).toBe(false);
    expect(recordNiyazDayRsvp).not.toHaveBeenCalled();
  });

  it("is a no-op (false) when the day can't be resolved", async () => {
    getEventConfigByDayId.mockResolvedValue(null);
    const ok = await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 99, lunchCount: 1, dinnerCount: 1 });
    expect(ok).toBe(false);
    expect(recordNiyazDayRsvp).not.toHaveBeenCalled();
  });

  it("rejects empty hof_its / non-finite day", async () => {
    expect(await recordNiyazRsvpFromInteractive({ hofIts: "", dayId: 2, lunchCount: 1, dinnerCount: 1 })).toBe(false);
    expect(await recordNiyazRsvpFromInteractive({ hofIts: "1", dayId: NaN, lunchCount: 1, dinnerCount: 1 })).toBe(false);
    expect(recordNiyazDayRsvp).not.toHaveBeenCalled();
  });
});
