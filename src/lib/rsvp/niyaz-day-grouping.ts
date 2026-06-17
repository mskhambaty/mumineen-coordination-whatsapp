// Pure, client-safe grouping of per-meal Niyaz events into day groups for the admin overview.
// No Supabase / server imports — safe to use in client components and unit tests.

export type Meal = "lunch" | "dinner";

// Minimal shape the grouping needs; the admin page passes its richer NiyazEvent (with tallies),
// which is structurally compatible, and gets the same type back inside each group.
export type GroupableEvent = {
  id: string;
  title: string;
  eventDate: string; // YYYY-MM-DD
  meal: Meal | null;
};

export type NiyazDayGroup<T extends GroupableEvent> = {
  date: string;
  /** Day title: a served-meal instance title (dinner preferred), falling back to any title or "". */
  title: string;
  /** This date's meal instances, lunch before dinner. */
  events: T[];
};

// Lunch sorts before dinner; anything without a meal sorts last (after both).
function mealRank(meal: Meal | null): number {
  if (meal === "lunch") return 0;
  if (meal === "dinner") return 1;
  return 2;
}

/**
 * Group per-meal events by `eventDate`. Days are ordered by date ascending; within a day, events
 * are ordered lunch → dinner. The day title prefers the dinner instance's title (the primary niyaz),
 * then any non-empty title, then "".
 */
export function groupTalliesByDay<T extends GroupableEvent>(events: T[]): NiyazDayGroup<T>[] {
  const byDate = new Map<string, T[]>();
  for (const e of events) {
    const list = byDate.get(e.eventDate);
    if (list) list.push(e);
    else byDate.set(e.eventDate, [e]);
  }

  const groups: NiyazDayGroup<T>[] = [];
  for (const [date, list] of byDate) {
    const sorted = [...list].sort((a, b) => mealRank(a.meal) - mealRank(b.meal));
    const dinner = sorted.find((e) => e.meal === "dinner");
    const titled = sorted.find((e) => e.title.trim().length > 0);
    const title = (dinner?.title.trim() ? dinner.title : titled?.title ?? "").trim();
    groups.push({ date, title, events: sorted });
  }

  groups.sort((a, b) => a.date.localeCompare(b.date));
  return groups;
}
