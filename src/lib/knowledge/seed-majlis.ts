// Daily seed: ensure the 6 per-category content slots exist for a given majlis, so the
// admin dashboard (and the agent) have the day's structure ready. English slots are
// created as 'placeholder' (awaiting fetch/transcription); Lisan slots as
// 'pending_translation' (awaiting the human English translation). Idempotent.

import {
  ASHARA_CATEGORIES,
  defaultStatus,
  majlisLabel,
  topicTitle,
} from "@/lib/knowledge/ashara-config";
import { createReligiousTopic, listReligiousTopics } from "@/lib/knowledge/religious-topics";

export type SeedTarget = { majlisNumber: number | null; isAshura: boolean };

export async function seedMajlisDay(
  year: string,
  target: SeedTarget,
): Promise<{ year: string; majlis: string; created: string[]; existing: string[] }> {
  const topics = await listReligiousTopics();
  const created: string[] = [];
  const existing: string[] = [];

  for (const cat of ASHARA_CATEGORIES) {
    const found = topics.find(
      (t) =>
        t.year_hijri === year &&
        t.category === cat.key &&
        (target.isAshura ? t.is_ashura : t.majlis_number === target.majlisNumber),
    );
    if (found) {
      existing.push(cat.key);
      continue;
    }
    await createReligiousTopic(topicTitle(cat.label, year, target.majlisNumber, target.isAshura), {
      yearHijri: year,
      majlisNumber: target.majlisNumber,
      isAshura: target.isAshura,
      category: cat.key,
      language: cat.language,
      status: defaultStatus(cat.language),
      sourceLabel: `Istibsaar — ${cat.label}, ${majlisLabel(target.majlisNumber, target.isAshura)} (${year}H)`,
    });
    created.push(cat.key);
  }

  return { year, majlis: majlisLabel(target.majlisNumber, target.isAshura), created, existing };
}

// Map "today" to a majlis using ASHARA_START_DATE (ISO date of Majlis 1 = 2nd Muharram).
// Days 0–7 → Majlis 1–8; days 8–9 → the combined Ashura block; otherwise null.
export function majlisForDate(startDateIso: string, nowMs: number): SeedTarget | null {
  const startMs = Date.parse(startDateIso);
  if (Number.isNaN(startMs)) return null;
  const dayIdx = Math.floor((nowMs - startMs) / 86_400_000);
  if (dayIdx < 0 || dayIdx > 9) return null;
  if (dayIdx <= 7) return { majlisNumber: dayIdx + 1, isAshura: false };
  return { majlisNumber: null, isAshura: true };
}
