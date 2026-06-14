import { getSupabaseAdmin } from "@/lib/supabase/server";

// Per-mumin Niyaz attendance over the `niyaz_rsvp` table: one row per (event, mumin), `attending`
// pre-seeded from each person's arrival date (migration + seed_family_niyaz_rsvp) and later
// overridden by the WhatsApp bot (whole-family cascade) or an admin. Each Niyaz event is one
// rsvp_registration_instance row with an (event_date, meal). head_count is gone — adult/kid/family
// counts come from joining mumineen.is_adult in the niyaz_event_tallies view.

export type Meal = "lunch" | "dinner";

export type NiyazEvent = {
  id: string;
  title: string;
  eventDate: string; // YYYY-MM-DD
  hijriDate: string | null;
  meal: Meal | null;
  servingType: string | null; // 'thaal' | 'packet'
  description: string | null;
};

type RawEvent = {
  id: string;
  title: string | null;
  event_date: string;
  hijri_date: string | null;
  meal: Meal | null;
  serving_type: string | null;
  description: string | null;
};
const toEvent = (r: RawEvent): NiyazEvent => ({
  id: r.id,
  title: r.title ?? "",
  eventDate: r.event_date,
  hijriDate: r.hijri_date,
  meal: r.meal,
  servingType: r.serving_type,
  description: r.description,
});

// All Niyaz events (instances with an event_date), ordered by day then meal.
export async function getEvents(): Promise<NiyazEvent[]> {
  const { data } = await getSupabaseAdmin()
    .from("rsvp_registration_instance")
    .select("id, title, event_date, hijri_date, meal, serving_type, description")
    .not("event_date", "is", null)
    .order("event_date", { ascending: true })
    .order("meal", { ascending: false });
  return ((data ?? []) as RawEvent[]).map(toEvent);
}

export type FamilyGridRow = {
  event: NiyazEvent;
  attending: number; // family members marked attending for this event
  adults: number; // attending members who are adults (is_adult null counts as adult)
  kids: number; // attending members who are kids (is_adult === false)
  total: number; // family members with an RSVP row for this event
};

// The caller's family grid: every event with how many of the family are attending (split into
// adults/kids so the agent can read back an accurate "2 adults, 2 kids") vs total. The adult/kid
// split joins mumineen.is_adult (null = adult), the same convention as the niyaz_event_tallies view.
export async function getFamilyNiyazGrid(familyId: string): Promise<FamilyGridRow[]> {
  const events = await getEvents();
  const { data } = await getSupabaseAdmin()
    .from("niyaz_rsvp")
    .select("registration_instance_id, attending, mumineen:mumineen!niyaz_rsvp_mumin_id_fkey(is_adult)")
    .eq("family_id", familyId);

  type GridRsvp = { registration_instance_id: string; attending: boolean; mumineen: { is_adult: boolean | null } | null };
  const agg = new Map<string, { yes: number; adults: number; kids: number; total: number }>();
  for (const r of (data ?? []) as unknown as GridRsvp[]) {
    const a = agg.get(r.registration_instance_id) ?? { yes: 0, adults: 0, kids: 0, total: 0 };
    a.total += 1;
    if (r.attending) {
      a.yes += 1;
      if (r.mumineen?.is_adult === false) a.kids += 1;
      else a.adults += 1; // null counts as adult
    }
    agg.set(r.registration_instance_id, a);
  }

  return events.map((event) => {
    const a = agg.get(event.id) ?? { yes: 0, adults: 0, kids: 0, total: 0 };
    return { event, attending: a.yes, adults: a.adults, kids: a.kids, total: a.total };
  });
}

export type FamilyMember = {
  name: string | null;
  isAdult: boolean;
  isHead: boolean;
  notAttending: boolean;
};

// The roster-active members of a family, for the agent to list when the user's requested count
// exceeds the family size ("your family includes: X, Y, Z — ask others to RSVP from their phone").
export async function getFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  const { data } = await getSupabaseAdmin()
    .from("mumineen")
    .select("full_name, is_adult, is_head, not_attending")
    .eq("family_id", familyId)
    .eq("roster_active", true)
    .order("is_head", { ascending: false });
  type Row = { full_name: string | null; is_adult: boolean | null; is_head: boolean | null; not_attending: boolean };
  return ((data ?? []) as Row[]).map((m) => ({
    name: m.full_name,
    isAdult: m.is_adult !== false,
    isHead: m.is_head === true,
    notAttending: m.not_attending,
  }));
}

// When the bot reads a registered family's RSVP back (GET), promote any default-sourced rows to
// whatsapp — the user has now seen and implicitly confirmed their attendance via a bot interaction.
// Fire-and-forget; doesn't change attending values, only the source tag so the min view picks them up.
export async function markFamilyRsvpConfirmed(familyId: string, phone: string): Promise<void> {
  await getSupabaseAdmin()
    .from("niyaz_rsvp")
    .update({ source: "whatsapp", responded_by_phone: phone })
    .eq("family_id", familyId)
    .in("source", ["default", "registration"]);
}

// One instruction from the agent/admin: mark a family attending (or not) for specific events,
// selected by event title (e.g. "Pehli Raat") and/or date, optionally narrowed to one meal.
// Omit all selectors (or set all=true) to apply to every event.
//
// `titles` is the preferred, guess-proof selector: the agent reads an event's exact title off the
// grid and passes it straight back, so the hijri night-shift (a dinner's date isn't the day you'd
// guess) can never produce a wrong date. A title like "2nd Moharram ul Haram" maps to BOTH a lunch
// and a dinner on different days — pair it with `meal` to disambiguate.
export type NiyazRsvpEntry = {
  attending: boolean;
  titles?: string[]; // event titles (case-insensitive), e.g. ["Pehli Raat"]
  dates?: string[]; // specific YYYY-MM-DD days
  meal?: Meal; // narrow to lunch or dinner; omit for both
  all?: boolean;
};

const normTitle = (s: string): string => s.trim().toLowerCase();

// When the caller asked for more attendees than the family has, `clamped` reports the cap that was
// applied so the agent can tell the user the extras must register from their own phones.
// `requestedTotal`/`maxTotal` carry the single-number (head-count) case; adults/kids the split case.
export type ClampNotice = {
  requestedAdults?: number;
  requestedKids?: number;
  requestedTotal?: number;
  maxAdults: number;
  maxKids: number;
  maxTotal: number;
};
export type ApplyResult = { updated: number; grid: FamilyGridRow[]; clamped?: ClampNotice };

type RsvpTarget = { muminId: string; notAttending: boolean; isAdult: boolean; isHead: boolean };
type ApplyOpts = { source: "whatsapp" | "admin"; phone?: string | null; recordedBy?: string | null; respectNotAttending?: boolean };
// Either an adults/kids split, or a single `total` head count (no split — fill in priority order).
type PartialCounts = { adults?: number; kids?: number; total?: number };

// Resolve entries → a per-event attending decision (last entry wins per event).
function decideEvents(events: NiyazEvent[], entries: NiyazRsvpEntry[]): Map<string, boolean> {
  const decisions = new Map<string, boolean>();
  for (const entry of entries) {
    const dateSet = entry.all || !entry.dates || entry.dates.length === 0 ? null : new Set(entry.dates);
    const titleSet = entry.all || !entry.titles || entry.titles.length === 0 ? null : new Set(entry.titles.map(normTitle));
    for (const ev of events) {
      if (dateSet && !dateSet.has(ev.eventDate)) continue;
      if (titleSet && !titleSet.has(normTitle(ev.title))) continue;
      if (entry.meal && ev.meal !== entry.meal) continue;
      decisions.set(ev.id, entry.attending);
    }
  }
  return decisions;
}

// Pick which members attend when the caller gives explicit adults/kids counts smaller than the
// family. Priority: head of family first, then other adults, then kids. Members flagged
// not_attending are excluded up front (they were never in the attending pool).
//
// Partial mode means "here is exactly who is attending this event", so an UNSPECIFIED category
// defaults to 0, not to the whole family. This is what stops "2 from my family will eat" (passed as
// {adults:2}) from silently keeping all the kids too — it now means 2 adults, 0 kids.
function selectPartialTargets(targets: RsvpTarget[], counts: PartialCounts): Set<string> {
  const eligible = targets.filter((t) => !t.notAttending);

  // Total mode (free-text head count): a single number with no adult/kid split. Fill in the same
  // priority order — head of family first, then other adults, then kids — until N are attending.
  if (counts.total !== undefined) {
    const ordered = [...eligible].sort((a, b) => {
      if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;
      if (a.isAdult !== b.isAdult) return a.isAdult ? -1 : 1;
      return 0;
    });
    return new Set(ordered.slice(0, counts.total).map((t) => t.muminId));
  }

  const adults = eligible.filter((t) => t.isAdult);
  const kids = eligible.filter((t) => !t.isAdult);

  const wantAdults = counts.adults ?? 0;
  const wantKids = counts.kids ?? 0;

  // Head of family first, then remaining adults
  const sortedAdults = [...adults].sort((a, b) => (a.isHead === b.isHead ? 0 : a.isHead ? -1 : 1));
  const pickedAdults = sortedAdults.slice(0, wantAdults);
  const pickedKids = kids.slice(0, wantKids);

  return new Set([...pickedAdults, ...pickedKids].map((t) => t.muminId));
}

// Core writer: upsert one niyaz_rsvp row per (event decision × target mumin). When
// `respectNotAttending`, a "yes" decision skips a member flagged not_attending (used by the family
// cascade so we don't pull an absent member into attendance; an explicit individual answer doesn't).
// When `partial` counts are given for attending=true events, only the selected subset attends and
// the rest are marked not-attending — so the per-member rows stay accurate.
async function applyNiyazRsvp(targets: RsvpTarget[], familyId: string | null, entries: NiyazRsvpEntry[], opts: ApplyOpts, partial?: PartialCounts): Promise<number> {
  if (targets.length === 0) return 0;
  const decisions = decideEvents(await getEvents(), entries);
  if (decisions.size === 0) return 0;

  const usePartial = partial && (partial.adults !== undefined || partial.kids !== undefined || partial.total !== undefined);
  const attendingSet = usePartial ? selectPartialTargets(targets, partial) : null;

  const rows: Record<string, unknown>[] = [];
  for (const [instanceId, attending] of decisions) {
    for (const t of targets) {
      if (attending && t.notAttending && opts.respectNotAttending) continue;
      const memberAttending = attending && attendingSet ? attendingSet.has(t.muminId) : attending;
      rows.push({
        registration_instance_id: instanceId,
        mumin_id: t.muminId,
        family_id: familyId,
        attending: memberAttending,
        source: opts.source,
        responded_by_phone: opts.phone ?? null,
        recorded_by: opts.recordedBy ?? null,
      });
    }
  }

  const supabase = getSupabaseAdmin();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("niyaz_rsvp")
      .upsert(rows.slice(i, i + 500), { onConflict: "registration_instance_id,mumin_id" });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

// Whole-family RSVP: cascades to ALL roster_active family members; a "yes" never flips a member
// flagged not_attending. When partial counts (adults/kids) are given and smaller than the family,
// only that many members are marked attending and the rest are marked not-attending — head of
// family is kept first, then remaining adults, then kids.
export async function setFamilyNiyazRsvp(
  familyId: string,
  entries: NiyazRsvpEntry[],
  opts: { source: "whatsapp" | "admin"; phone?: string | null; recordedBy?: string | null },
  partial?: PartialCounts,
): Promise<ApplyResult> {
  const { data: members } = await getSupabaseAdmin()
    .from("mumineen")
    .select("id, not_attending, is_adult, is_head")
    .eq("family_id", familyId)
    .eq("roster_active", true);
  type Row = { id: string; not_attending: boolean; is_adult: boolean | null; is_head: boolean | null };
  const targets = ((members ?? []) as Row[]).map((m) => ({
    muminId: m.id,
    notAttending: m.not_attending,
    isAdult: m.is_adult !== false,
    isHead: m.is_head === true,
  }));
  // Clamp partial counts to actual family size so the agent can't inflate numbers
  const eligible = targets.filter((t) => !t.notAttending);
  const maxAdults = eligible.filter((t) => t.isAdult).length;
  const maxKids = eligible.filter((t) => !t.isAdult).length;
  const maxTotal = eligible.length;
  const clampedCounts: PartialCounts | undefined = partial
    ? {
        adults: partial.adults !== undefined ? Math.min(partial.adults, maxAdults) : undefined,
        kids: partial.kids !== undefined ? Math.min(partial.kids, maxKids) : undefined,
        total: partial.total !== undefined ? Math.min(partial.total, maxTotal) : undefined,
      }
    : undefined;
  // Flag when the requested counts exceeded the family — so the agent tells the user the extras
  // must message this number from their own phones to register and RSVP separately.
  const wasClamped =
    (partial?.adults !== undefined && partial.adults > maxAdults) ||
    (partial?.kids !== undefined && partial.kids > maxKids) ||
    (partial?.total !== undefined && partial.total > maxTotal);
  const clamped: ClampNotice | undefined = wasClamped
    ? { requestedAdults: partial?.adults, requestedKids: partial?.kids, requestedTotal: partial?.total, maxAdults, maxKids, maxTotal }
    : undefined;
  const updated = await applyNiyazRsvp(targets, familyId, entries, { ...opts, respectNotAttending: true }, clampedCounts);
  return { updated, grid: await getFamilyNiyazGrid(familyId), clamped };
}

// Individual RSVP: records only the one responding mumin (their explicit answer overrides the
// not_attending flag). `familyId` is stored for grouping.
export async function setMuminNiyazRsvp(
  muminId: string,
  familyId: string | null,
  entries: NiyazRsvpEntry[],
  opts: { source: "whatsapp" | "admin"; phone?: string | null; recordedBy?: string | null },
): Promise<ApplyResult> {
  const updated = await applyNiyazRsvp([{ muminId, notAttending: false, isAdult: true, isHead: false }], familyId, entries, { ...opts, respectNotAttending: false });
  return { updated, grid: familyId ? await getFamilyNiyazGrid(familyId) : [] };
}

// --- WhatsApp daily button taps ---
export type NiyazLevel = "ind" | "fam";
export type NiyazScope = "both" | "lunch" | "dinner" | "none";

// Map a button scope to RSVP entries for one date.
export function scopeToEntries(scope: NiyazScope, date: string): NiyazRsvpEntry[] {
  switch (scope) {
    case "both":
      return [{ attending: true, dates: [date] }];
    case "none":
      return [{ attending: false, dates: [date] }];
    case "lunch":
      return [{ attending: true, meal: "lunch", dates: [date] }, { attending: false, meal: "dinner", dates: [date] }];
    case "dinner":
      return [{ attending: false, meal: "lunch", dates: [date] }, { attending: true, meal: "dinner", dates: [date] }];
  }
}

// --- Free-text family head counts (niyaz_family_headcount) ---

// Record a whole-family head count for a date (applies to every event that day). The single number
// is materialized as the SOURCE OF TRUTH through niyaz_rsvp: we allocate exactly that many attending
// member rows (head → adults → kids, clamped to the family's roster) so the per-member table and any
// count query agree — no parallel number to double-count. The raw reply is also kept in
// niyaz_family_headcount purely as an audit record of what the family literally said (it is NOT
// separately summed into tallies). When the number exceeds the family's roster, the returned
// `clamped` reports the cap so the caller can nudge the extras to register from their own phones.
export async function recordFamilyHeadCount(
  familyId: string,
  date: string,
  headCount: number,
  phone?: string | null,
): Promise<ApplyResult> {
  const events = (await getEvents()).filter((e) => e.eventDate === date);
  if (events.length === 0) return { updated: 0, grid: await getFamilyNiyazGrid(familyId) };

  // Allocate the head count across the family's members in niyaz_rsvp (single source of truth).
  const result = await setFamilyNiyazRsvp(
    familyId,
    [{ attending: true, dates: [date] }],
    { source: "whatsapp", phone },
    { total: headCount },
  );

  // Keep the raw reported number per (event, family) as an audit record of the literal reply.
  const rows = events.map((e) => ({
    registration_instance_id: e.id,
    family_id: familyId,
    head_count: headCount,
    source: "whatsapp",
    responded_by_phone: phone ?? null,
  }));
  const { error } = await getSupabaseAdmin()
    .from("niyaz_family_headcount")
    .upsert(rows, { onConflict: "registration_instance_id,family_id" });
  if (error) throw new Error(error.message);

  return result;
}

export type FamilyHeadCountRow = {
  id: string;
  family_id: string;
  head_count: number;
  responded_by_phone: string | null;
  updated_at: string;
  family: { hof_its: string | null } | null;
};

// Family head-count rows for one event (for the admin event detail).
export async function getFamilyHeadCounts(instanceId: string): Promise<FamilyHeadCountRow[]> {
  const { data } = await getSupabaseAdmin()
    .from("niyaz_family_headcount")
    .select("id, family_id, head_count, responded_by_phone, updated_at, family:families!niyaz_family_headcount_family_id_fkey(hof_its)")
    .eq("registration_instance_id", instanceId)
    .order("updated_at", { ascending: false });
  return (data ?? []) as unknown as FamilyHeadCountRow[];
}

// Record a daily-template button tap: individual (just this mumin) or family (whole family).
export async function recordNiyazButtonResponse(input: {
  level: NiyazLevel;
  scope: NiyazScope;
  date: string;
  muminId: string;
  familyId: string | null;
  phone?: string | null;
}): Promise<ApplyResult> {
  const entries = scopeToEntries(input.scope, input.date);
  const opts = { source: "whatsapp" as const, phone: input.phone ?? null };
  return input.level === "fam" && input.familyId
    ? setFamilyNiyazRsvp(input.familyId, entries, opts)
    : setMuminNiyazRsvp(input.muminId, input.familyId, entries, opts);
}

export type EventTally = NiyazEvent & {
  yesAdults: number;
  yesKids: number;
  yesFamilies: number;
  thaalCount: number;
  noAdults: number;
  noKids: number;
  noFamilies: number;
  unregAdults: number;
  unregKids: number;
  headcountHeads: number;
  rsvpCount: number;
};

export type TallyMode = "max" | "min";

// Per-event attendance tallies for the admin page. mode=max uses the full niyaz_event_tallies
// view (arrival-date defaults + overrides); mode=min uses only whatsapp/admin-confirmed RSVPs.
// Both include unregistered RSVP totals. Thaal count = ceil((regYes + unregYes) / 8).
export async function getEventTallies(mode: TallyMode = "max"): Promise<EventTally[]> {
  const supabase = getSupabaseAdmin();
  const events = await getEvents();

  type Row = {
    instance_id: string;
    yes_adults: number;
    yes_kids: number;
    yes_families: number;
    thaal_count: number | string;
    no_adults: number;
    no_kids: number;
    no_families: number;
  };

  let tallyRows: Row[];
  if (mode === "min") {
    const { data } = await supabase.rpc("niyaz_event_tallies_min");
    tallyRows = (data ?? []) as Row[];
  } else {
    const { data } = await supabase
      .from("niyaz_event_tallies")
      .select("instance_id, yes_adults, yes_kids, yes_families, thaal_count, no_adults, no_kids, no_families");
    tallyRows = (data ?? []) as Row[];
  }
  const byId = new Map<string, Row>();
  for (const r of tallyRows) byId.set(r.instance_id, r);

  // Family head-count totals per event.
  const { data: hc } = await supabase.from("niyaz_family_headcount").select("registration_instance_id, head_count");
  const headsById = new Map<string, number>();
  for (const r of (hc ?? []) as { registration_instance_id: string; head_count: number }[]) {
    headsById.set(r.registration_instance_id, (headsById.get(r.registration_instance_id) ?? 0) + (r.head_count ?? 0));
  }

  const unregById = await getUnregisteredTallies();

  return events.map((event) => {
    const t = byId.get(event.id);
    const yesAdults = Number(t?.yes_adults ?? 0);
    const yesKids = Number(t?.yes_kids ?? 0);
    // headcountHeads is the raw free-text reply, kept for display only. The attendance it represents
    // is already materialized into niyaz_rsvp (and thus into yesAdults/yesKids), so it must NOT be
    // added to the total — doing so double-counts the same family.
    const headcountHeads = headsById.get(event.id) ?? 0;
    const unreg = unregById.get(event.id) ?? { adults: 0, kids: 0 };
    const totalYes = yesAdults + yesKids + unreg.adults + unreg.kids;
    return {
      ...event,
      yesAdults,
      yesKids,
      yesFamilies: Number(t?.yes_families ?? 0),
      thaalCount: Math.ceil(totalYes / 8),
      noAdults: Number(t?.no_adults ?? 0),
      noKids: Number(t?.no_kids ?? 0),
      noFamilies: Number(t?.no_families ?? 0),
      unregAdults: unreg.adults,
      unregKids: unreg.kids,
      headcountHeads,
      rsvpCount: totalYes,
    };
  });
}

// --- Unregistered RSVPs ---

// Record an unregistered caller's RSVP from one or more entries (same attending/dates/meal/all model
// as the registered path). `decideEvents` resolves each event's attending value (last entry wins),
// so a baseline like {attending:true, all:true} plus exceptions records the FULL grid correctly.
// adults/kids/its_number are only written when provided, so a later partial update (e.g. cancelling
// one meal) never clobbers a previously-supplied head count or ITS.
export async function recordUnregisteredRsvp(input: {
  phone: string;
  entries: NiyazRsvpEntry[];
  adults?: number;
  kids?: number;
  itsNumber?: string | null;
  source?: "whatsapp" | "admin";
}): Promise<{ upserted: number }> {
  const decisions = decideEvents(await getEvents(), input.entries);
  if (decisions.size === 0) return { upserted: 0 };

  const rows = [...decisions].map(([instanceId, attending]) => {
    const row: Record<string, unknown> = {
      phone_e164: input.phone,
      registration_instance_id: instanceId,
      attending,
      source: input.source ?? "whatsapp",
    };
    if (input.adults !== undefined) row.adults = input.adults;
    if (input.kids !== undefined) row.kids = input.kids;
    if (input.itsNumber !== undefined && input.itsNumber !== null) row.its_number = input.itsNumber;
    return row;
  });

  const { error } = await getSupabaseAdmin()
    .from("unregistered_rsvps")
    .upsert(rows, { onConflict: "phone_e164,registration_instance_id" });
  if (error) throw new Error(error.message);
  return { upserted: rows.length };
}

export async function recordUnregisteredHeadCount(
  phone: string,
  date: string,
  count: number,
): Promise<number> {
  const events = (await getEvents()).filter((e) => e.eventDate === date);
  if (events.length === 0) return 0;

  const supabase = getSupabaseAdmin();
  let updated = 0;
  for (const e of events) {
    const { error } = await supabase
      .from("unregistered_rsvps")
      .upsert(
        { phone_e164: phone, registration_instance_id: e.id, adults: count, attending: true, source: "whatsapp" },
        { onConflict: "phone_e164,registration_instance_id" },
      );
    if (!error) updated++;
  }
  return updated;
}

export type UnregisteredRsvpRow = {
  id: string;
  registration_instance_id: string;
  adults: number;
  kids: number;
  attending: boolean;
  its_number: string | null;
  event_date: string;
  meal: string | null;
  title: string | null;
};

export async function getUnregisteredRsvps(phone: string): Promise<UnregisteredRsvpRow[]> {
  const { data } = await getSupabaseAdmin()
    .from("unregistered_rsvps")
    .select("id, registration_instance_id, adults, kids, attending, its_number, rsvp_registration_instance!inner(event_date, meal, title)")
    .eq("phone_e164", phone)
    .eq("attending", true);

  return (data ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const inst = rec.rsvp_registration_instance as Record<string, unknown> | null;
    return {
      id: rec.id as string,
      registration_instance_id: rec.registration_instance_id as string,
      adults: rec.adults as number,
      kids: rec.kids as number,
      attending: rec.attending as boolean,
      its_number: rec.its_number as string | null,
      event_date: (inst?.event_date as string) ?? "",
      meal: (inst?.meal as string) ?? null,
      title: (inst?.title as string) ?? null,
    };
  });
}

async function getUnregisteredTallies(): Promise<Map<string, { adults: number; kids: number }>> {
  const { data } = await getSupabaseAdmin()
    .from("unregistered_rsvps")
    .select("registration_instance_id, adults, kids")
    .eq("attending", true);

  const byId = new Map<string, { adults: number; kids: number }>();
  for (const r of (data ?? []) as { registration_instance_id: string; adults: number; kids: number }[]) {
    const cur = byId.get(r.registration_instance_id) ?? { adults: 0, kids: 0 };
    cur.adults += r.adults;
    cur.kids += r.kids;
    byId.set(r.registration_instance_id, cur);
  }
  return byId;
}

// Attending head counts for one calendar day, split by meal — for the nightly department digest.
// After a family registers, merge any unregistered RSVPs from their phone numbers into proper
// niyaz_rsvp rows, then delete the unregistered records. This ensures the min tab picks up
// their confirmed attendance, and the unregistered counts drop accordingly.
export async function mergeUnregisteredRsvps(familyId: string, phones: string[]): Promise<number> {
  if (phones.length === 0) return 0;
  const supabase = getSupabaseAdmin();

  const { data: unreg } = await supabase
    .from("unregistered_rsvps")
    .select("id, registration_instance_id, attending")
    .in("phone_e164", phones);

  if (!unreg || unreg.length === 0) return 0;

  const now = new Date().toISOString();

  // Apply both attending and not-attending unregistered RSVPs to the family's niyaz_rsvp rows.
  // The seed function already created default rows for the family — we override with the
  // explicit choice the person made before registering.
  const attending = unreg.filter((r) => r.attending).map((r) => r.registration_instance_id);
  const notAttending = unreg.filter((r) => !r.attending).map((r) => r.registration_instance_id);

  if (attending.length > 0) {
    await supabase
      .from("niyaz_rsvp")
      .update({ source: "whatsapp", attending: true, updated_at: now })
      .eq("family_id", familyId)
      .in("registration_instance_id", attending);
  }
  if (notAttending.length > 0) {
    await supabase
      .from("niyaz_rsvp")
      .update({ source: "whatsapp", attending: false, updated_at: now })
      .eq("family_id", familyId)
      .in("registration_instance_id", notAttending);
  }

  // Delete the merged unregistered records.
  const ids = unreg.map((r) => r.id);
  await supabase.from("unregistered_rsvps").delete().in("id", ids);

  // Clean up orphaned prompts for these phones.
  await supabase
    .from("niyaz_rsvp_prompts")
    .delete()
    .in("phone_e164", phones)
    .is("family_id", null);

  return unreg.length;
}

export async function getMealAttendanceTotals(date: string): Promise<{ date: string | null; lunch: number; dinner: number }> {
  const events = (await getEvents()).filter((e) => e.eventDate === date);
  if (events.length === 0) return { date: null, lunch: 0, dinner: 0 };

  const supabase = getSupabaseAdmin();
  let lunch = 0;
  let dinner = 0;
  for (const ev of events) {
    const { count } = await supabase
      .from("niyaz_rsvp")
      .select("id", { count: "exact", head: true })
      .eq("registration_instance_id", ev.id)
      .eq("attending", true);
    if (ev.meal === "lunch") lunch += count ?? 0;
    else dinner += count ?? 0;
  }
  return { date, lunch, dinner };
}
