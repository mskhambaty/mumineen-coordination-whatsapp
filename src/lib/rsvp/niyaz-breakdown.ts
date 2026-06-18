// Local-vs-Mehmaan breakdown for the admin Niyaz event-detail "Breakdown" panel.
//
// IMPORTANT: this must NOT be computed from the per-mumin niyaz_rsvp list the API returns — that list
// is capped by PostgREST's db-max-rows (1000), so on a large event it is a truncated slice and any
// count derived from it is wrong. The counts come from the DB aggregate `niyaz_event_breakdown(id)`
// (see the matching migration), exactly as the headline Yes/No tally already does.
//
// The RPC returns one row per local/mehman group with both min and max columns; assembleBreakdown
// picks the columns for the active mode and rolls the groups up into a total. The classifier helpers
// below are still used client-side for the responses-table chip filters.

export type TallyMode = "min" | "max";

// is_adult is null for adults (roster convention); only an explicit false is a kid.
export function isKid(isAdult: boolean | null): boolean {
  return isAdult === false;
}

// Anything that isn't explicitly "Mehman" is treated as local.
export function isMehman(localMehman: string | null): boolean {
  return localMehman === "Mehman";
}

// An active confirmation, as opposed to a seeded/registration default.
export function hasResponded(source: string): boolean {
  return source === "whatsapp" || source === "admin";
}

// One group row as returned by the niyaz_event_breakdown RPC. `grp` is the 3-way classifier
// ('local' | 'mehman' | 'guest'); guests are synthetic overflow placeholders (sentinel ITS), kept
// separate so the member rows stay clean while local+mehman+guest still reconciles with the headline.
// Counts may arrive as number or string (Postgres bigint over PostgREST), so callers coerce with Number().
export type BreakdownGroup = "local" | "mehman" | "guest";

export type BreakdownRpcRow = {
  grp: BreakdownGroup;
  yes_min: number | string;
  no_min: number | string;
  yes_adults_min: number | string;
  yes_kids_min: number | string;
  no_adults_min: number | string;
  no_kids_min: number | string;
  yes_max: number | string;
  no_max: number | string;
  yes_adults_max: number | string;
  yes_kids_max: number | string;
  no_adults_max: number | string;
  no_kids_max: number | string;
  responded: number | string;
  not_responded: number | string;
};

export type GroupBreakdown = {
  yes: number;
  no: number;
  yesAdults: number;
  yesKids: number;
  noAdults: number;
  noKids: number;
  responded: number;
  notResponded: number;
  // Share of the group's people who actively responded (0–1). 0 when the group is empty.
  responseRate: number;
};

export type NiyazBreakdown = {
  local: GroupBreakdown;
  mehman: GroupBreakdown;
  // Synthetic overflow guests (sentinel-ITS placeholders). Counted in the headline/Thaals but not a
  // real member group — shown on its own row so the member rows stay clean and Total still reconciles.
  guest: GroupBreakdown;
  total: GroupBreakdown;
};

function emptyGroup(): GroupBreakdown {
  return { yes: 0, no: 0, yesAdults: 0, yesKids: 0, noAdults: 0, noKids: 0, responded: 0, notResponded: 0, responseRate: 0 };
}

const n = (v: number | string): number => Number(v) || 0;

// Map one RPC row to a GroupBreakdown for the active mode. Yes/No (and the adult/kid split) honour
// min vs max so they reconcile with the headline; responded/not-responded is source-based (same in
// both modes).
function fromRpcRow(row: BreakdownRpcRow, mode: TallyMode): GroupBreakdown {
  const min = mode === "min";
  const responded = n(row.responded);
  const notResponded = n(row.not_responded);
  const people = responded + notResponded;
  return {
    yes: n(min ? row.yes_min : row.yes_max),
    no: n(min ? row.no_min : row.no_max),
    yesAdults: n(min ? row.yes_adults_min : row.yes_adults_max),
    yesKids: n(min ? row.yes_kids_min : row.yes_kids_max),
    noAdults: n(min ? row.no_adults_min : row.no_adults_max),
    noKids: n(min ? row.no_kids_min : row.no_kids_max),
    responded,
    notResponded,
    responseRate: people > 0 ? responded / people : 0,
  };
}

function addInto(total: GroupBreakdown, g: GroupBreakdown): void {
  total.yes += g.yes;
  total.no += g.no;
  total.yesAdults += g.yesAdults;
  total.yesKids += g.yesKids;
  total.noAdults += g.noAdults;
  total.noKids += g.noKids;
  total.responded += g.responded;
  total.notResponded += g.notResponded;
}

export function assembleBreakdown(rows: BreakdownRpcRow[], mode: TallyMode): NiyazBreakdown {
  const groups: Record<BreakdownGroup, GroupBreakdown> = {
    local: emptyGroup(),
    mehman: emptyGroup(),
    guest: emptyGroup(),
  };
  const total = emptyGroup();

  for (const row of rows) {
    const g = fromRpcRow(row, mode);
    addInto(groups[row.grp] ?? groups.local, g);
    addInto(total, g);
  }

  for (const grp of [groups.local, groups.mehman, groups.guest, total]) {
    const people = grp.responded + grp.notResponded;
    grp.responseRate = people > 0 ? grp.responded / people : 0;
  }

  return { local: groups.local, mehman: groups.mehman, guest: groups.guest, total };
}
