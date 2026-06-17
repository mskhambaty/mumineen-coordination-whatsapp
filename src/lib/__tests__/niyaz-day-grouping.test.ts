import { describe, expect, it } from "vitest";

import { groupTalliesByDay, type GroupableEvent } from "@/lib/rsvp/niyaz-day-grouping";

type Ev = GroupableEvent & { yes: number };

const ev = (id: string, eventDate: string, meal: Ev["meal"], title: string, yes = 0): Ev => ({
  id,
  eventDate,
  meal,
  title,
  yes,
});

describe("groupTalliesByDay", () => {
  it("groups a date's lunch + dinner into one day, lunch before dinner", () => {
    const groups = groupTalliesByDay<Ev>([
      ev("d", "2026-06-16", "dinner", "2nd Moharram ul Haram", 33),
      ev("l", "2026-06-16", "lunch", "2nd Moharram ul Haram", 30),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2026-06-16");
    expect(groups[0].events.map((e) => e.meal)).toEqual(["lunch", "dinner"]);
  });

  it("orders days by date ascending", () => {
    const groups = groupTalliesByDay<Ev>([
      ev("c", "2026-06-24", "dinner", "Ashura", 1),
      ev("a", "2026-06-14", "dinner", "Pehli Raat", 1),
      ev("b", "2026-06-16", "lunch", "2nd Moharram ul Haram", 1),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-06-14", "2026-06-16", "2026-06-24"]);
  });

  it("handles single-meal days (Pehli Raat / Ashura dinner-only)", () => {
    const groups = groupTalliesByDay<Ev>([ev("a", "2026-06-14", "dinner", "Pehli Raat", 902)]);
    expect(groups[0].events).toHaveLength(1);
    expect(groups[0].title).toBe("Pehli Raat");
  });

  it("prefers the dinner title for the day, falling back to any title then empty", () => {
    const lunchOnly = groupTalliesByDay<Ev>([
      ev("l", "2026-06-15", "lunch", "1st Moharram ul Haram", 0),
      ev("d", "2026-06-15", "dinner", "", 0),
    ]);
    // dinner title is empty → falls back to the lunch title
    expect(lunchOnly[0].title).toBe("1st Moharram ul Haram");

    const dinnerTitled = groupTalliesByDay<Ev>([
      ev("l", "2026-06-16", "lunch", "Lunch label", 0),
      ev("d", "2026-06-16", "dinner", "Dinner label", 0),
    ]);
    expect(dinnerTitled[0].title).toBe("Dinner label");

    const untitled = groupTalliesByDay<Ev>([ev("x", "2026-06-17", null, "   ", 0)]);
    expect(untitled[0].title).toBe("");
  });
});
