import { describe, expect, it } from "vitest";

import { groupEventsByDay, type NiyazEvent } from "@/lib/rsvp/meal-rsvp";

// `groupEventsByDay` is pure (events + a date→title map in, day skeletons out), so it's tested
// directly with no DB mocks. It collapses per-meal events into one row per Gregorian day and resolves
// the DAY title (config first), which is the core of the per-day RSVP summary.

const ev = (over: Partial<NiyazEvent> & Pick<NiyazEvent, "eventDate" | "meal">): NiyazEvent => ({
  id: `${over.eventDate}-${over.meal}`,
  title: "",
  hijriDate: null,
  servingType: null,
  description: null,
  ...over,
});

describe("groupEventsByDay", () => {
  it("collapses a lunch + dinner on the same date into one day with both meals served", () => {
    const days = groupEventsByDay(
      [
        ev({ eventDate: "2026-06-15", meal: "lunch", title: "1st Moharram ul Haram" }),
        ev({ eventDate: "2026-06-15", meal: "dinner", title: "2nd Moharram ul Haram" }),
      ],
      new Map([["2026-06-15", "1st Moharram ul Haram"]]),
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2026-06-15", title: "1st Moharram ul Haram", lunch: true, dinner: true });
  });

  it("marks a dinner-only day with lunch:false (e.g. Pehli Raat / Ashura)", () => {
    const days = groupEventsByDay(
      [ev({ eventDate: "2026-06-24", meal: "dinner", title: "10th Moharram ul Haram (Ashura)" })],
      new Map(),
    );
    expect(days[0].lunch).toBe(false);
    expect(days[0].dinner).toBe(true);
  });

  it("uses the config title first, then the per-meal instance title as fallback", () => {
    // No config entry for this date → falls back to the LUNCH instance title (not the dinner's,
    // which is the night-shifted name).
    const days = groupEventsByDay(
      [
        ev({ eventDate: "2026-06-15", meal: "lunch", title: "1st Moharram ul Haram" }),
        ev({ eventDate: "2026-06-15", meal: "dinner", title: "2nd Moharram ul Haram" }),
      ],
      new Map(),
    );
    expect(days[0].title).toBe("1st Moharram ul Haram");
  });

  it("falls back to the dinner title when there is no config and no lunch, then to the date", () => {
    expect(
      groupEventsByDay([ev({ eventDate: "2026-06-14", meal: "dinner", title: "Pehli Raat" })], new Map())[0].title,
    ).toBe("Pehli Raat");
    expect(
      groupEventsByDay([ev({ eventDate: "2026-06-14", meal: "dinner", title: "" })], new Map())[0].title,
    ).toBe("2026-06-14");
  });

  it("returns days sorted ascending by date regardless of input order", () => {
    const days = groupEventsByDay(
      [
        ev({ eventDate: "2026-06-24", meal: "dinner" }),
        ev({ eventDate: "2026-06-15", meal: "lunch" }),
        ev({ eventDate: "2026-06-16", meal: "dinner" }),
      ],
      new Map(),
    );
    expect(days.map((d) => d.date)).toEqual(["2026-06-15", "2026-06-16", "2026-06-24"]);
  });
});
