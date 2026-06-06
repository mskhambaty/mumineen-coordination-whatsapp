// Pure rollup + filter logic for the parking pass tool. No Supabase imports so it
// can be unit-tested directly (src/lib/__tests__/parking-rollups.test.ts) and shared
// between the API routes and the admin page.

export const LOT_PURPOSES = [
  "vip_incapacitated",
  "foreign_mehman",
  "all_65_plus",
  "chicago",
  "early_khidmat",
] as const;

export const PURPOSE_LABELS: Record<string, string> = {
  vip_incapacitated: "VIP / Incapacitated",
  foreign_mehman: "Foreign Mehman",
  all_65_plus: "All 65+",
  chicago: "Chicago",
  early_khidmat: "Early Khidmat",
};

// Known pass colors offered as suggestions in the lot editor. Plain text by design —
// duplicates across lots are fine (passes also print lot name) and a 9th color may appear.
export const SUGGESTED_COLORS = ["Blue", "Yellow", "Gold", "Green", "Orchid", "Pink", "Cream", "White"];

export type RollupFamily = {
  id: string;
  hof_its: string;
  transport_mode: string | null;
};

export type RollupMember = {
  hof_its: string;
  is_head: boolean;
  full_name: string | null;
  whatsapp_e164: string | null;
  local_mehman: string | null;
  age: number | null;
  category: string | null;
  rahat_seating: boolean;
  wheelchair: boolean;
};

export type PassInfo = {
  id: string;
  lot_id: string;
  lot_name: string;
  lot_color: string | null;
  notes: string | null;
};

export type HouseholdRow = {
  family_id: string;
  hof_its: string;
  head_name: string;
  phone: string | null;
  local_mehman: string | null;
  transport_mode: string | null;
  member_count: number;
  eligible: boolean;
  rahat_count: number;
  wheelchair_count: number;
  senior_count: number;
  all_65_plus: boolean;
  all_rahat: boolean;
  categories: string[];
  kids_under_7: number;
  passes: PassInfo[];
};

export function buildHouseholdRow(
  family: RollupFamily,
  members: RollupMember[],
  passes: PassInfo[],
): HouseholdRow {
  const head = members.find((m) => m.is_head) ?? members[0] ?? null;
  const localMehman = head?.local_mehman ?? null;
  return {
    family_id: family.id,
    hof_its: family.hof_its,
    head_name: head?.full_name ?? family.hof_its,
    phone: head?.whatsapp_e164 ?? members.find((m) => m.whatsapp_e164)?.whatsapp_e164 ?? null,
    local_mehman: localMehman,
    transport_mode: family.transport_mode,
    member_count: members.length,
    // Default pass rule: every local household; mehman only if they rented a car.
    eligible: localMehman === "Local" || (localMehman === "Mehman" && family.transport_mode === "rental"),
    rahat_count: members.filter((m) => m.rahat_seating || m.wheelchair).length,
    wheelchair_count: members.filter((m) => m.wheelchair).length,
    senior_count: members.filter((m) => (m.age ?? -1) >= 65).length,
    // Null ages count as "not 65+" so incomplete data never inflates this whole-household flag.
    all_65_plus: members.length > 0 && members.every((m) => (m.age ?? -1) >= 65),
    all_rahat: members.length > 0 && members.every((m) => m.rahat_seating || m.wheelchair),
    categories: [...new Set(members.map((m) => m.category).filter((c): c is string => Boolean(c)))],
    kids_under_7: members.filter((m) => m.age !== null && m.age < 7).length,
    passes,
  };
}

// Does this household fit a lot's designated purposes? Used by the bulk bar to warn
// (never block) when selected households don't match the target lot's designation.
// A household qualifies if it matches ANY one of the lot's purposes. early_khidmat
// isn't data-derivable ("demonstrated need to be early" lives in the team's heads),
// and unknown/empty purposes accept everyone — the warning only fires on a clear miss.
export function matchesLotPurposes(row: HouseholdRow, purposes: string[]): boolean {
  if (purposes.length === 0) return true;
  return purposes.some((p) => {
    switch (p) {
      case "vip_incapacitated":
        return row.categories.length > 0 || row.rahat_count > 0;
      case "foreign_mehman":
        return row.local_mehman === "Mehman";
      case "all_65_plus":
        return row.all_65_plus;
      case "chicago":
        return row.local_mehman === "Local";
      default:
        // early_khidmat and any future purpose: no data check, everyone qualifies.
        return true;
    }
  });
}

// Picks the first `count` households (in display order) that don't already hold a pass
// in the given lot — powers the capacity-aware "Select up to remaining" bulk action.
export function pickAssignable(rows: HouseholdRow[], lotId: string, count: number): string[] {
  const picked: string[] = [];
  for (const row of rows) {
    if (picked.length >= count) break;
    if (row.passes.some((p) => p.lot_id === lotId)) continue;
    picked.push(row.family_id);
  }
  return picked;
}

export type HouseholdFilters = {
  eligible?: boolean;
  local_mehman?: string; // "Local" | "Mehman" | "" (all)
  rahat_senior?: boolean; // any rahat-flagged member OR any member 65+
  all_rahat?: boolean; // every member rahat-flagged
  all_65?: boolean; // every member 65+
  wheelchair?: boolean; // any member needing a wheelchair
  has_phone?: boolean; // household has a contact phone number
  has_category?: boolean; // any member carries a roster category value (e.g. VIP)
  kids_under_7?: boolean;
  assigned?: "assigned" | "unassigned" | "";
  q?: string; // head-name substring, case-insensitive
};

export function matchesFilters(row: HouseholdRow, f: HouseholdFilters): boolean {
  if (f.eligible && !row.eligible) return false;
  if (f.local_mehman && row.local_mehman !== f.local_mehman) return false;
  if (f.rahat_senior && row.rahat_count === 0 && row.senior_count === 0) return false;
  if (f.all_rahat && !row.all_rahat) return false;
  if (f.all_65 && !row.all_65_plus) return false;
  if (f.wheelchair && row.wheelchair_count === 0) return false;
  if (f.has_phone && !row.phone) return false;
  if (f.has_category && row.categories.length === 0) return false;
  if (f.kids_under_7 && row.kids_under_7 === 0) return false;
  if (f.assigned === "assigned" && row.passes.length === 0) return false;
  if (f.assigned === "unassigned" && row.passes.length > 0) return false;
  if (f.q && !row.head_name.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}
