// Authoritative parking entry guidance per pass color, surfaced to the public agent via
// GET /api/parking/my-passes (and the PARKING_RULE in run-agent.ts). Source of truth provided
// by the Transport team (June 2026). Pure data + helper so it can be unit-tested and shared.

// Everyone approaches the same way; the pass color only decides the entry point.
export const PARKING_GENERAL_ACCESS =
  "Access the masjid complex via southbound Route 83 / Kingery Highway.";

// Rideshare (Uber/Lyft) drop-off and pick-up — distinct from the per-color parking entries.
export const PARKING_RIDESHARE_DROPOFF =
  "For rideshare drop-off and pick-up, the designated area is the Wat Buddha Damma Meditation Center temple.";

export type ParkingEntryInfo = {
  label: string;
  // Who the color is for, when it's a special-purpose pass (gold/green). Omitted for general lots.
  purpose?: string;
  // The entry point / parking location for this color.
  entry: string;
};

export const PARKING_ENTRY_BY_COLOR: Record<string, ParkingEntryInfo> = {
  red: { label: "Red", entry: "Enter the masjid complex via Hillside Lane at 16W581 Hillside Lane." },
  white: { label: "White", entry: "Enter the masjid complex via the Macedonian Church on Route 83." },
  blue: { label: "Blue", entry: "Enter the masjid complex via the Mecca Center on 91st Street." },
  gold: {
    label: "Gold",
    purpose: "Gold passes are for mumineen requiring wheelchair support.",
    entry: "Gold entry access is from 10S280 Kingery Hwy.",
  },
  green: {
    label: "Green",
    purpose: "Green passes are khidmat guzaar passes, for mumineen needing early access and late departure.",
    entry: "Park at Anne Jeans School or Burr Ridge Middle School.",
  },
};

// Look up the entry guidance for a lot color (case-insensitive). Returns null for unknown colors.
export function parkingEntryFor(color: string | null | undefined): ParkingEntryInfo | null {
  if (!color) return null;
  return PARKING_ENTRY_BY_COLOR[color.trim().toLowerCase()] ?? null;
}
