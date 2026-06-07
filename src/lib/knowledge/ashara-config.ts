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

// "Start here" istibsaar search link for a majlis (delegates click through to read the
// original; also used as the citation source until an exact item URL is known).
export function istibsaarSearchUrl(majlisNumber: number | null, isAshura: boolean, year: string): string {
  const yy = year.slice(-2); // 1448 -> 48
  const miqaat = isAshura
    ? "Majlis 9 & 10 - Ashara Mubarak"
    : `Majlis ${majlisNumber} - Ashara Mubaraka ${yy}H`;
  return `https://www.talabulilm.com/istibsaar/search?miqaat=${encodeURIComponent(miqaat)}`;
}

// Canonical title for a per-majlis topic block, e.g. "Al-Dars — Ashara 1448H, Majlis 2".
export function topicTitle(categoryLabel: string, year: string, majlisNumber: number | null, isAshura: boolean): string {
  return `${categoryLabel} — Ashara ${year}H, ${majlisLabel(majlisNumber, isAshura)}`;
}

// New English slots await content; Lisan slots await a human translation.
export function defaultStatus(language: ReligiousLanguage): ReligiousStatus {
  return language === "lisan" ? "pending_translation" : "placeholder";
}
