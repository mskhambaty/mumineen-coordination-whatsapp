import { describe, expect, it } from "vitest";

import { buildDailyTimeline } from "@/lib/charts/timeline";

describe("buildDailyTimeline", () => {
  it("returns [] for empty input", () => {
    expect(buildDailyTimeline([])).toEqual([]);
  });

  it("collapses multiple same-day timestamps into one point", () => {
    const points = buildDailyTimeline([
      "2026-06-06T09:00:00Z",
      "2026-06-06T18:30:00Z",
      "2026-06-06T23:59:59Z",
    ]);
    expect(points).toEqual([{ date: "2026-06-06", count: 3, cumulative: 3 }]);
  });

  it("sorts out-of-order timestamps and runs a monotonic cumulative total", () => {
    const points = buildDailyTimeline([
      "2026-06-08T10:00:00Z",
      "2026-06-06T10:00:00Z",
      "2026-06-07T10:00:00Z",
      "2026-06-06T12:00:00Z",
    ]);
    expect(points).toEqual([
      { date: "2026-06-06", count: 2, cumulative: 2 },
      { date: "2026-06-07", count: 1, cumulative: 3 },
      { date: "2026-06-08", count: 1, cumulative: 4 },
    ]);
    // cumulative is non-decreasing and ends at the total count
    const cumulatives = points.map((p) => p.cumulative);
    expect(cumulatives).toEqual([...cumulatives].sort((a, b) => a - b));
    expect(points.at(-1)?.cumulative).toBe(4);
  });

  it("skips blank or malformed entries", () => {
    const points = buildDailyTimeline(["", "nope", "2026-06-06T10:00:00Z"]);
    expect(points).toEqual([{ date: "2026-06-06", count: 1, cumulative: 1 }]);
  });
});
