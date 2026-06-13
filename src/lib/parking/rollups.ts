// Pure rollup + filter logic for the parking pass tool. No Supabase imports so it
// can be unit-tested directly (src/lib/__tests__/parking-rollups.test.ts) and shared
// between the API routes and the admin page.

export const LOT_PURPOSES = [
  "vip",
  "ada",
  "foreign_mehman",
  "all_65_plus",
  "chicago",
  "early_khidmat",
] as const;

export const PURPOSE_LABELS: Record<string, string> = {
  vip: "VIP",
  ada: "ADA",
  foreign_mehman: "Foreign Mehman",
  all_65_plus: "All 65+",
  chicago: "Chicago",
  early_khidmat: "Early Khidmat",
};

// Known pass colors offered as suggestions in the lot editor. Plain text by design —
// duplicates across lots are fine (passes also print lot name) and a 9th color may appear.
export const SUGGESTED_COLORS = ["Blue", "Yellow", "Gold", "Green", "Orchid", "Pink", "Cream", "White", "Red"];

export type RollupFamily = {
  id: string;
  hof_its: string;
  transport_mode: string | null;
  utaro_host_its: string | null;
};

// Same formula as the estimates route — kept here so parking page and estimates stay in sync.
export function localFamilyPasses(attendingCount: number): number {
  return attendingCount > 0 ? Math.ceil(attendingCount / 5) : 0;
}

export type RollupMember = {
  hof_its: string;
  is_head: boolean;
  full_name: string | null;
  whatsapp_e164: string | null;
  local_mehman: string | null;
  city: string | null;
  age: number | null;
  category: string | null;
  rahat_seating: boolean;
  wheelchair: boolean;
  not_attending: boolean | null;
};

export type PassInfo = {
  id: string;
  lot_id: string;
  lot_name: string;
  lot_color: string | null;
  notes: string | null;
  printed_at: string | null;
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
  suggested_passes: number;
  utaro_guest_count: number;         // total attending utaro guests
  utaro_guest_commute_count: number; // non-rental guests (share host's parking pass)
  utaro_guest_rental_count: number;  // rental guests (have their own pass)
  rahat_count: number;
  wheelchair_count: number;
  senior_count: number;
  all_65_plus: boolean;
  all_rahat: boolean;
  categories: string[];
  kids_under_7: number;
  passes: PassInfo[];
  has_unprinted_passes: boolean;
};

// guestFamilies: utaro guests staying with this household. Non-rental guests share the
// host's parking pass (headcount + criteria both roll up into the host row).
export function buildHouseholdRow(
  family: RollupFamily,
  members: RollupMember[],
  passes: PassInfo[],
  guestFamilies: { attendingCount: number; transport_mode: string | null; members?: RollupMember[] }[] = [],
): HouseholdRow {
  const head = members.find((m) => m.is_head) ?? members[0] ?? null;
  const localMehman = head?.local_mehman ?? null;
  const isNorthChicago = head?.city?.trim().toLowerCase() === "north chicago";
  // All rollups are scoped to attending members only — non-attending members
  // take no parking spot and should not influence eligibility or criteria flags.
  const attending = members.filter((m) => !m.not_attending);
  const attendingCount = attending.length;

  // Attending members of commute (non-rental) utaro guests — they share the host's
  // parking pass so their criteria (rahat, age, etc.) are relevant to the host row.
  const commuteGuestAttending = guestFamilies
    .filter((g) => g.transport_mode !== "rental")
    .flatMap((g) => (g.members ?? []).filter((m) => !m.not_attending));

  // Combined set used for all criteria rollups.
  const allAttending = [...attending, ...commuteGuestAttending];
  const allCount = allAttending.length;

  // Suggested passes follow the estimates formula exactly:
  // Local: ceil((own attending + non-rental guest attending) / 5)
  // Mehman rental: 1 pass per family
  let suggested_passes = 0;
  if (localMehman === "Local") {
    const guestCount = guestFamilies
      .filter((g) => g.transport_mode !== "rental")
      .reduce((sum, g) => sum + g.attendingCount, 0);
    suggested_passes = localFamilyPasses(attendingCount + guestCount);
  } else if (localMehman === "Mehman" && family.transport_mode === "rental") {
    suggested_passes = 1;
  }

  return {
    family_id: family.id,
    hof_its: family.hof_its,
    head_name: head?.full_name ?? family.hof_its,
    phone: head?.whatsapp_e164 ?? members.find((m) => m.whatsapp_e164)?.whatsapp_e164 ?? null,
    local_mehman: localMehman,
    transport_mode: family.transport_mode,
    member_count: attendingCount,
    // Default pass rule: local household with ≥1 attending member; mehman only if they rented a car.
    // North Chicago households are excluded — they use a separate lot not managed here.
    eligible: !isNorthChicago && attendingCount > 0 && (localMehman === "Local" || (localMehman === "Mehman" && family.transport_mode === "rental")),
    suggested_passes,
    utaro_guest_count: guestFamilies.reduce((sum, g) => sum + g.attendingCount, 0),
    utaro_guest_commute_count: guestFamilies
      .filter((g) => g.transport_mode !== "rental")
      .reduce((sum, g) => sum + g.attendingCount, 0),
    utaro_guest_rental_count: guestFamilies
      .filter((g) => g.transport_mode === "rental")
      .reduce((sum, g) => sum + g.attendingCount, 0),
    rahat_count: allAttending.filter((m) => m.rahat_seating || m.wheelchair).length,
    wheelchair_count: allAttending.filter((m) => m.wheelchair).length,
    senior_count: allAttending.filter((m) => (m.age ?? -1) >= 65).length,
    // Null ages count as "not 65+" so incomplete data never inflates this whole-household flag.
    all_65_plus: allCount > 0 && allAttending.every((m) => (m.age ?? -1) >= 65),
    all_rahat: allCount > 0 && allAttending.every((m) => m.rahat_seating || m.wheelchair),
    categories: [...new Set(allAttending.map((m) => m.category).filter((c): c is string => Boolean(c)))],
    kids_under_7: allAttending.filter((m) => m.age !== null && m.age < 7).length,
    passes,
    has_unprinted_passes: passes.some((p) => p.printed_at === null),
  };
}

// Purposes with a household-level data check (see matchesLotPurposes). early_khidmat
// and unknown purposes accept everyone by design.
const DATA_CHECKED_PURPOSES = ["vip", "ada", "foreign_mehman", "all_65_plus", "chicago"];

// Can this purpose set actually exclude anyone? Because matchesLotPurposes is an OR,
// one always-true purpose (early_khidmat, unknown, or none) makes everyone qualify —
// in that case the auto "Fits lot purposes" narrowing chip would be noise, so hide it.
export function lotPurposesNarrow(purposes: string[]): boolean {
  return purposes.length > 0 && purposes.every((p) => DATA_CHECKED_PURPOSES.includes(p));
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
      case "vip":
        return row.categories.length > 0;
      case "ada":
        return row.rahat_count > 0;
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
  // Structural filters — always applied as AND regardless of filterMode.
  eligible?: boolean; // tri-state: true = eligible only, false = ineligible only
  local_mehman?: string; // "Local" | "Mehman" | "" (all)
  assigned?: "assigned" | "unassigned" | "";
  q?: string; // head-name or ITS substring, case-insensitive
  // "and": row must match all active criteria chips.
  // "or":  row must match at least one active criteria chip.
  filterMode?: "and" | "or";
  // Tri-state criteria chips: true = must match, false = must NOT match, undefined = inactive.
  any_rahat?: boolean;    // any rahat-flagged or wheelchair member
  any_senior?: boolean;   // any member 65+
  all_rahat?: boolean;    // every attending member rahat-flagged
  all_65?: boolean;       // every attending member 65+
  wheelchair?: boolean;   // any member needing a wheelchair
  has_phone?: boolean;    // household has a contact phone number
  has_category?: boolean; // any member carries a roster category value (e.g. VIP)
  kids_under_7?: boolean;
  unprinted_passes?: boolean; // true = has at least one unprinted pass
};

export function matchesFilters(row: HouseholdRow, f: HouseholdFilters): boolean {
  // Structural filters — always AND.
  if (f.eligible === true  && !row.eligible) return false;
  if (f.eligible === false && row.eligible)  return false;
  if (f.local_mehman && row.local_mehman !== f.local_mehman) return false;
  if (f.assigned === "assigned"   && row.passes.length === 0) return false;
  if (f.assigned === "unassigned" && row.passes.length > 0)  return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!row.head_name.toLowerCase().includes(q) && !row.hof_its.includes(q)) return false;
  }

  // Criteria chips — collect active ones then apply AND / OR.
  const checks: Array<() => boolean> = [];
  if (f.any_rahat    !== undefined) checks.push(() => f.any_rahat    === true ? row.rahat_count > 0        : row.rahat_count === 0);
  if (f.any_senior   !== undefined) checks.push(() => f.any_senior   === true ? row.senior_count > 0       : row.senior_count === 0);
  if (f.all_rahat    !== undefined) checks.push(() => f.all_rahat    === true ? row.all_rahat              : !row.all_rahat);
  if (f.all_65       !== undefined) checks.push(() => f.all_65       === true ? row.all_65_plus            : !row.all_65_plus);
  if (f.wheelchair   !== undefined) checks.push(() => f.wheelchair   === true ? row.wheelchair_count > 0   : row.wheelchair_count === 0);
  if (f.has_phone    !== undefined) checks.push(() => f.has_phone    === true ? Boolean(row.phone)         : !row.phone);
  if (f.has_category !== undefined) checks.push(() => f.has_category === true ? row.categories.length > 0  : row.categories.length === 0);
  if (f.kids_under_7       !== undefined) checks.push(() => f.kids_under_7       === true ? row.kids_under_7 > 0             : row.kids_under_7 === 0);
  if (f.unprinted_passes   !== undefined) checks.push(() => f.unprinted_passes   === true ? row.has_unprinted_passes          : !row.has_unprinted_passes);

  if (checks.length === 0) return true;
  return f.filterMode === "or"
    ? checks.some((c) => c())
    : checks.every((c) => c());
}
