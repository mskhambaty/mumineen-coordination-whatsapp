import { describe, expect, it } from "vitest";

import { decideEvents, type NiyazEvent } from "@/lib/rsvp/meal-rsvp";

// A small two-day fixture: each day has a lunch + a dinner instance.
const EVENTS: NiyazEvent[] = [
  { id: "d1-lunch", title: "1st Moharram ul Haram", eventDate: "2026-06-18", hijriDate: null, meal: "lunch", servingType: null, description: null },
  { id: "d1-dinner", title: "1st Moharram ul Haram", eventDate: "2026-06-18", hijriDate: null, meal: "dinner", servingType: null, description: null },
  { id: "d2-lunch", title: "2nd Moharram ul Haram", eventDate: "2026-06-19", hijriDate: null, meal: "lunch", servingType: null, description: null },
  { id: "d2-dinner", title: "2nd Moharram ul Haram", eventDate: "2026-06-19", hijriDate: null, meal: "dinner", servingType: null, description: null },
];

describe("decideEvents", () => {
  it("does NOT cascade a selector-less entry to every event", () => {
    // The bug: {attending:false} with no dates/titles/meal/all silently matched
    // every event, so a single-day intent wiped the whole Ashara. A global change
    // must be explicit (all:true) — a selector-less entry targets nothing.
    const decisions = decideEvents(EVENTS, [{ attending: false }]);
    expect(decisions.size).toBe(0);
  });

  it("scopes a dated entry to only that day", () => {
    const decisions = decideEvents(EVENTS, [{ attending: false, dates: ["2026-06-18"], meal: "dinner" }]);
    expect([...decisions.keys()]).toEqual(["d1-dinner"]);
    expect(decisions.get("d1-dinner")).toBe(false);
  });

  it("still applies a global change when all:true is explicit", () => {
    const decisions = decideEvents(EVENTS, [{ attending: false, all: true }]);
    expect(decisions.size).toBe(4);
    expect([...decisions.values()].every((v) => v === false)).toBe(true);
  });

  it("honors all:true narrowed by meal", () => {
    const decisions = decideEvents(EVENTS, [{ attending: false, meal: "dinner", all: true }]);
    expect([...decisions.keys()].sort()).toEqual(["d1-dinner", "d2-dinner"]);
  });
});
