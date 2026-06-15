// Shared config for the per-majlis Ashara content model. Used by the admin "Ashara
// dashboard" and the daily seed workflow so both agree on categories, titles, and the
// English-vs-Lisan handling that drives the translate loop.

import type { ReligiousCategory, ReligiousLanguage, ReligiousStatus } from "@/lib/knowledge/religious-topics";

export type AsharaCategory = {
  key: Exclude<ReligiousCategory, "misc">;
  label: string;
  language: ReligiousLanguage;
  // Lisan items must be translated by a human before indexing; English ones are just
  // awaiting their content (auto-fetch or transcription).
  sameDayTranslate?: boolean;
};

// The 6 categories ingested for each majlis (user-selected scope).
export const ASHARA_CATEGORIES: AsharaCategory[] = [
  { key: "reflection", label: "Reflections", language: "en" },
  { key: "tazyeen", label: "Tazyeen", language: "en" },
  { key: "al_dars", label: "Al-Dars", language: "en" },
  { key: "jumla", label: "Jumla", language: "lisan", sameDayTranslate: true },
  { key: "kalema", label: "Kalema", language: "lisan", sameDayTranslate: true },
  { key: "unwaan", label: "Unwaan", language: "lisan", sameDayTranslate: true },
];

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  ASHARA_CATEGORIES.map((c) => [c.key, c.label]),
);

// Majlis rows for the grid: 1–8, then the combined Lailat/Ashura (9/10) block.
export type AsharaRow = { majlisNumber: number | null; isAshura: boolean; label: string };
export const ASHARA_ROWS: AsharaRow[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ majlisNumber: n, isAshura: false, label: `Majlis ${n}` })),
  { majlisNumber: null, isAshura: true, label: "Majlis 9/10 (Ashura)" },
];

export const DEFAULT_ACTIVE_YEAR = "1448";

// The upcoming/ongoing Ashara (the "event" users mean by "this year / this Ashara"), and
// the most recent COMPLETED Ashara that actually has indexed content (what "last year" means,
// and the sensible default when no year is given). We anchor on the EVENT, not the Hijri
// calendar year — right now it's the tail of 1447H but the next Ashara is 1448H, so "this
// year's Ashara" means 1448 even though the calendar year is still 1447.
export const ACTIVE_ASHARA_YEAR = DEFAULT_ACTIVE_YEAR; // "1448"
export const LAST_COMPLETED_ASHARA_YEAR = "1447";

// First Gregorian day of an Ashara (Majlis 1's date), or null if not in the calendar.
export function asharaStartIso(year: string): string | null {
  return ASHARA_CALENDAR[year]?.[0] ?? null;
}

export type YearCue = "explicit" | "this" | "last" | "today" | "none";
export type YearResolution = { year: string | null; cue: YearCue; activeStarted: boolean };

// Resolve which Ashara year a religious query refers to, removing the "this year" ambiguity.
// - explicit "1447/47H" → that year
// - "last year / previous Ashara" → most-recent completed (LAST_COMPLETED_ASHARA_YEAR)
// - "this year / this Ashara / upcoming / today" → the active event (ACTIVE_ASHARA_YEAR)
// - nothing → null (caller defaults to most-recent available)
// `activeStarted` tells the caller whether the active Ashara has begun (for "today" wording).
export function resolveAsharaYear(query: string, todayIso: string): YearResolution {
  const q = ` ${query.toLowerCase()} `;
  const startIso = asharaStartIso(ACTIVE_ASHARA_YEAR);
  const activeStarted = !!startIso && todayIso >= startIso;

  const ex = q.match(/\b(14\d\d)\s*h?\b/);
  if (ex) return { year: ex[1], cue: "explicit", activeStarted };
  if (/\b(last year|previous year|previous ashara|last ashara|pichhla|pichla|gaya saal|gayu varas)\b/.test(q))
    return { year: LAST_COMPLETED_ASHARA_YEAR, cue: "last", activeStarted };
  if (/\b(today|todays|today's|tonight|aaj)\b/.test(q))
    return { year: ACTIVE_ASHARA_YEAR, cue: "today", activeStarted };
  if (/\b(this year|this years|this year's|this ashara|current ashara|coming ashara|upcoming ashara|upcoming|aa saal|aa varas)\b/.test(q))
    return { year: ACTIVE_ASHARA_YEAR, cue: "this", activeStarted };
  return { year: null, cue: "none", activeStarted };
}

// Gregorian date (YYYY-MM-DD) of each majlis, indexed to ASHARA_ROWS order
// (Majlis 1–8, then the combined 9/10 Ashura block). Drives the dashboard's
// "today's majlis" highlight. Add future years here as they're confirmed.
export const ASHARA_CALENDAR: Record<string, string[]> = {
  "1448": [
    "2026-06-16", // Majlis 1 — 2nd Moharram
    "2026-06-17", // Majlis 2 — 3rd
    "2026-06-18", // Majlis 3 — 4th
    "2026-06-19", // Majlis 4 — 5th
    "2026-06-20", // Majlis 5 — 6th
    "2026-06-21", // Majlis 6 — 7th
    "2026-06-22", // Majlis 7 — 8th
    "2026-06-23", // Majlis 8 — 9th
    "2026-06-24", // Majlis 9/10 — 10th (Ashura)
  ],
};

// The row index (into ASHARA_ROWS) whose date matches `todayIso`, or null if today
// isn't an Ashara day for that year.
export function majlisRowForToday(year: string, todayIso: string): number | null {
  const cal = ASHARA_CALENDAR[year];
  if (!cal) return null;
  const i = cal.indexOf(todayIso);
  return i === -1 ? null : i;
}

export function majlisLabel(majlisNumber: number | null, isAshura: boolean): string {
  return isAshura ? "Majlis 9/10 (Ashura)" : `Majlis ${majlisNumber}`;
}

// Canonical title for a per-majlis topic block, e.g. "Al-Dars — Ashara 1448H, Majlis 2".
export function topicTitle(categoryLabel: string, year: string, majlisNumber: number | null, isAshura: boolean): string {
  return `${categoryLabel} — Ashara ${year}H, ${majlisLabel(majlisNumber, isAshura)}`;
}

// --- Source-citation collapse ---------------------------------------------------------------
// When one religious answer draws on this many DISTINCT majlis/articles, the per-majlis links
// are collapsed into a single year-archive link instead of stacking 3–5 "Source:" lines.
export const SOURCE_COLLAPSE_THRESHOLD = 2;

// The blog's per-year reflections index (verified live, e.g. 1447H lists every majlis). `year`
// is the 4-digit Hijri year. This is the link a collapsed multi-majlis citation points to.
export function reflectionsArchiveUrl(year: string): string {
  return `https://blogs.jameasaifiyah.edu/reflection-category/${year}h/`;
}

// Stable Ashara Mubaraka landing page — the no-year fallback when the year is unknown.
export const ASHARA_CATEGORY_PAGE = "https://blogs.jameasaifiyah.edu/ashara-mubaraka/";

// New English slots await content; Lisan slots await a human translation.
export function defaultStatus(language: ReligiousLanguage): ReligiousStatus {
  return language === "lisan" ? "pending_translation" : "placeholder";
}
