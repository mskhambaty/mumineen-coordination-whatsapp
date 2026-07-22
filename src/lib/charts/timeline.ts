// Pure, client-safe timeline builder for "over time" bar charts (registrations, RSVP responses, …).
// Turns a flat list of ISO timestamps into per-day points with a running cumulative total. The day
// key is the date portion (YYYY-MM-DD) of each timestamp, so callers don't pre-bucket.

export type TimelinePoint = { date: string; count: number; cumulative: number };

// Group ISO timestamps by calendar day, sort ascending, and accumulate a running total. Blank/invalid
// entries (no YYYY-MM-DD prefix) are skipped. Returns [] for empty input.
export function buildDailyTimeline(dates: string[]): TimelinePoint[] {
  const byDay = new Map<string, number>();
  for (const ts of dates) {
    if (!ts) continue;
    const day = ts.slice(0, 10);
    if (day.length !== 10) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  let cumulative = 0;
  return Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => {
      cumulative += count;
      return { date, count, cumulative };
    });
}
