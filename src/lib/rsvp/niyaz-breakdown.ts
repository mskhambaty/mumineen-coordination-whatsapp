// Pure, React-free breakdown math for the admin Niyaz event-detail page.
//
// The page already holds the full per-mumin niyaz_rsvp row set, so we derive the Local-vs-Mehmaan
// and responded-vs-not-responded splits client-side rather than adding new SQL views. To stay exactly
// consistent with the mode-aware headline tally:
//   - "max" counts every row (matches the niyaz_event_tallies view)
//   - "min" counts only source in (whatsapp, admin) (matches niyaz_event_tallies_min)
// Responded/not-responded is source-based and therefore mode-independent.
// Unregistered guests are excluded here (no local/mehmaan or person-level source), same as the headline.

export type TallyMode = "min" | "max";

export type BreakdownRow = {
  attending: boolean;
  source: string;
  is_adult: boolean | null;
  local_mehman: string | null;
};

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

// Whether a row contributes to the Yes/No counts in the given mode.
export function countsInMode(source: string, mode: TallyMode): boolean {
  return mode === "max" || hasResponded(source);
}

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
  total: GroupBreakdown;
};

function emptyGroup(): GroupBreakdown {
  return { yes: 0, no: 0, yesAdults: 0, yesKids: 0, noAdults: 0, noKids: 0, responded: 0, notResponded: 0, responseRate: 0 };
}

function accumulate(group: GroupBreakdown, row: BreakdownRow, mode: TallyMode): void {
  // Responded/not-responded reflects engagement regardless of mode.
  if (hasResponded(row.source)) group.responded += 1;
  else group.notResponded += 1;

  // Yes/No (and the adult/kid split) honour the active mode so they reconcile with the headline.
  if (!countsInMode(row.source, mode)) return;
  const kid = isKid(row.is_adult);
  if (row.attending) {
    group.yes += 1;
    if (kid) group.yesKids += 1;
    else group.yesAdults += 1;
  } else {
    group.no += 1;
    if (kid) group.noKids += 1;
    else group.noAdults += 1;
  }
}

function finalizeRate(group: GroupBreakdown): void {
  const people = group.responded + group.notResponded;
  group.responseRate = people > 0 ? group.responded / people : 0;
}

export function computeNiyazBreakdown(rows: BreakdownRow[], mode: TallyMode): NiyazBreakdown {
  const local = emptyGroup();
  const mehman = emptyGroup();
  const total = emptyGroup();

  for (const row of rows) {
    const group = isMehman(row.local_mehman) ? mehman : local;
    accumulate(group, row, mode);
    accumulate(total, row, mode);
  }

  finalizeRate(local);
  finalizeRate(mehman);
  finalizeRate(total);

  return { local, mehman, total };
}
