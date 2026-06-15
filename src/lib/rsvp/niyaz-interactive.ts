import { getEventConfigByDayId } from "@/lib/rsvp/event-config";
import { getFamilyByHofIts, recordNiyazDayRsvp } from "@/lib/rsvp/meal-rsvp";

// Phase 2: decode a double-RSVP interactive response into niyaz_rsvp records. The payload carries
// the family (hof_its), the niyaz DAY (registration_instance_id = niyaz_event_config.day_id), and the
// lunch/dinner attending counts. Resolves the family + day, then writes/reconciles per-meal
// attendance (real members + guest overflow) via recordNiyazDayRsvp. Returns false (no throw) when the
// family or day can't be resolved, so the raw capture is never lost.
export async function recordNiyazRsvpFromInteractive(opts: {
  hofIts: string;
  dayId: number;
  lunchCount: number;
  dinnerCount: number;
  phone?: string | null;
}): Promise<boolean> {
  if (!opts.hofIts || !Number.isFinite(opts.dayId)) return false;
  const family = await getFamilyByHofIts(opts.hofIts);
  if (!family) return false;
  const config = await getEventConfigByDayId(opts.dayId);
  if (!config?.eventDate) return false;
  await recordNiyazDayRsvp(family.familyId, family.hofIts, config.eventDate, opts.lunchCount, opts.dinnerCount, opts.phone ?? null);
  return true;
}

// Parse the integer count fields a WhatsApp Flow returns (they arrive as strings like "2").
export function parseCount(v: unknown): number {
  const n = parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
