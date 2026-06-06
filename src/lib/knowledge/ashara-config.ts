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

export function majlisLabel(majlisNumber: number | null, isAshura: boolean): string {
  return isAshura ? "Majlis 9/10 (Ashura)" : `Majlis ${majlisNumber}`;
}

// Canonical title for a per-majlis topic block, e.g. "Al-Dars — Ashara 1448H, Majlis 2".
export function topicTitle(categoryLabel: string, year: string, majlisNumber: number | null, isAshura: boolean): string {
  return `${categoryLabel} — Ashara ${year}H, ${majlisLabel(majlisNumber, isAshura)}`;
}

// New English slots await content; Lisan slots await a human translation.
export function defaultStatus(language: ReligiousLanguage): ReligiousStatus {
  return language === "lisan" ? "pending_translation" : "placeholder";
}
