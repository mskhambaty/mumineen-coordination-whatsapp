// "Eligible to RSVP" breakdown for the admin Niyaz event-detail "Breakdown" panel.
//
// IMPORTANT: this must NOT be computed from the per-mumin niyaz_rsvp list the API returns — that list
// is capped by PostgREST's db-max-rows (1000), so on a large event it is a truncated slice and any
// count derived from it is wrong. The counts come from the DB aggregate `niyaz_event_breakdown(id)`
// (see the matching migration), which aggregates the whole event with no row cap.
//
// The RPC returns one row per group ('local' | 'mehman' from the eligible-to-RSVP population, plus a
// 'guest' row for sentinel-ITS placeholders that RSVP'd yes). Yes/No are confirmation-based
// (source whatsapp/admin), responded = yes + no, and not_responded is the COMPLEMENT within the
// eligible population (default/roster/registration/no-row). assembleBreakdown rolls local+mehman into
// a member Total; guests are kept separate (not in the member Total). The classifier helpers below are
// still used client-side for the responses-table chip filters.

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

// One group row as returned by the niyaz_event_breakdown RPC. `grp` is 'local' | 'mehman' | 'guest'.
// Counts may arrive as number or string (Postgres bigint over PostgREST), so callers coerce with Number().
export type BreakdownGroup = "local" | "mehman" | "guest";

export type BreakdownRpcRow = {
  grp: BreakdownGroup;
  eligible: number | string;
  yes: number | string;
  no: number | string;
  yes_adults: number | string;
  yes_kids: number | string;
  no_adults: number | string;
  no_kids: number | string;
  responded: number | string;
  not_responded: number | string;
};

export type GroupBreakdown = {
  // Eligible-to-RSVP members in this group (0 for the guest row — guests aren't an eligible population).
  eligible: number;
  yes: number;
  no: number;
  yesAdults: number;
  yesKids: number;
  noAdults: number;
  noKids: number;
  responded: number;
  notResponded: number;
  // Responded / eligible (0–1). 0 when the group has no eligible members.
  responseRate: number;
};

export type NiyazBreakdown = {
  local: GroupBreakdown;
  mehman: GroupBreakdown;
  // Overflow guest placeholders (sentinel ITS) that RSVP'd yes. Counted in the headline/Thaals but not
  // an eligible member group — kept separate from the member Total.
  guest: GroupBreakdown;
  // Local + Mehmaan eligible members (guests NOT included).
  total: GroupBreakdown;
};

function emptyGroup(): GroupBreakdown {
  return { eligible: 0, yes: 0, no: 0, yesAdults: 0, yesKids: 0, noAdults: 0, noKids: 0, responded: 0, notResponded: 0, responseRate: 0 };
}

const n = (v: number | string): number => Number(v) || 0;

function fromRpcRow(row: BreakdownRpcRow): GroupBreakdown {
  const eligible = n(row.eligible);
  const responded = n(row.responded);
  return {
    eligible,
    yes: n(row.yes),
    no: n(row.no),
    yesAdults: n(row.yes_adults),
    yesKids: n(row.yes_kids),
    noAdults: n(row.no_adults),
    noKids: n(row.no_kids),
    responded,
    notResponded: n(row.not_responded),
    responseRate: eligible > 0 ? responded / eligible : 0,
  };
}

function addInto(total: GroupBreakdown, g: GroupBreakdown): void {
  total.eligible += g.eligible;
  total.yes += g.yes;
  total.no += g.no;
  total.yesAdults += g.yesAdults;
  total.yesKids += g.yesKids;
  total.noAdults += g.noAdults;
  total.noKids += g.noKids;
  total.responded += g.responded;
  total.notResponded += g.notResponded;
}

export function assembleBreakdown(rows: BreakdownRpcRow[]): NiyazBreakdown {
  const groups: Record<BreakdownGroup, GroupBreakdown> = {
    local: emptyGroup(),
    mehman: emptyGroup(),
    guest: emptyGroup(),
  };
  const total = emptyGroup();

  for (const row of rows) {
    const g = fromRpcRow(row);
    addInto(groups[row.grp] ?? groups.local, g);
    // Total is eligible members only — guests are a separate population.
    if (row.grp !== "guest") addInto(total, g);
  }

  // addInto only sums counts; (re)compute each group's rate from the accumulated eligible/responded.
  for (const grp of [groups.local, groups.mehman, groups.guest, total]) {
    grp.responseRate = grp.eligible > 0 ? grp.responded / grp.eligible : 0;
  }

  return { local: groups.local, mehman: groups.mehman, guest: groups.guest, total };
}
