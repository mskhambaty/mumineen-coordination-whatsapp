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
  total: number; // family members with an RSVP row for this event
};

// The caller's family grid: every event with how many of the family are attending vs total.
export async function getFamilyNiyazGrid(familyId: string): Promise<FamilyGridRow[]> {
  const events = await getEvents();
  const { data } = await getSupabaseAdmin()
    .from("niyaz_rsvp")
    .select("registration_instance_id, attending")
    .eq("family_id", familyId);

  const agg = new Map<string, { yes: number; total: number }>();
  for (const r of (data ?? []) as { registration_instance_id: string; attending: boolean }[]) {
    const a = agg.get(r.registration_instance_id) ?? { yes: 0, total: 0 };
    a.total += 1;
    if (r.attending) a.yes += 1;
    agg.set(r.registration_instance_id, a);
  }

  return events.map((event) => {
    const a = agg.get(event.id) ?? { yes: 0, total: 0 };
    return { event, attending: a.yes, total: a.total };
  });
}

// One instruction from the agent/admin: mark a family attending (or not) for specific dates (or all
// days), optionally narrowed to one meal. Omit dates (or set all=true) to apply to every event.
export type NiyazRsvpEntry = {
  attending: boolean;
  dates?: string[]; // specific YYYY-MM-DD days
  meal?: Meal; // narrow to lunch or dinner; omit for both
  all?: boolean;
};

export type ApplyResult = { updated: number; grid: FamilyGridRow[] };

type RsvpTarget = { muminId: string; notAttending: boolean };
type ApplyOpts = { source: "whatsapp" | "admin"; phone?: string | null; recordedBy?: string | null; respectNotAttending?: boolean };

// Resolve entries → a per-event attending decision (last entry wins per event).
function decideEvents(events: NiyazEvent[], entries: NiyazRsvpEntry[]): Map<string, boolean> {
  const decisions = new Map<string, boolean>();
  for (const entry of entries) {
    const dateSet = entry.all || !entry.dates || entry.dates.length === 0 ? null : new Set(entry.dates);
    for (const ev of events) {
      if (dateSet && !dateSet.has(ev.eventDate)) continue;
      if (entry.meal && ev.meal !== entry.meal) continue;
      decisions.set(ev.id, entry.attending);
    }
  }
  return decisions;
}

// Core writer: upsert one niyaz_rsvp row per (event decision × target mumin). When
// `respectNotAttending`, a "yes" decision skips a member flagged not_attending (used by the family
// cascade so we don't pull an absent member into attendance; an explicit individual answer doesn't).
async function applyNiyazRsvp(targets: RsvpTarget[], familyId: string | null, entries: NiyazRsvpEntry[], opts: ApplyOpts): Promise<number> {
  if (targets.length === 0) return 0;
  const decisions = decideEvents(await getEvents(), entries);
  if (decisions.size === 0) return 0;

  const rows: Record<string, unknown>[] = [];
  for (const [instanceId, attending] of decisions) {
    for (const t of targets) {
      if (attending && t.notAttending && opts.respectNotAttending) continue;
      rows.push({
        registration_instance_id: instanceId,
        mumin_id: t.muminId,
        family_id: familyId,
        attending,
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
// flagged not_attending. Upserts override the per-mumin row (whatsapp/admin beat the default).
export async function setFamilyNiyazRsvp(
  familyId: string,
  entries: NiyazRsvpEntry[],
  opts: { source: "whatsapp" | "admin"; phone?: string | null; recordedBy?: string | null },
): Promise<ApplyResult> {
  const { data: members } = await getSupabaseAdmin()
    .from("mumineen")
    .select("id, not_attending")
    .eq("family_id", familyId)
    .eq("roster_active", true);
  const targets = ((members ?? []) as { id: string; not_attending: boolean }[]).map((m) => ({ muminId: m.id, notAttending: m.not_attending }));
  const updated = await applyNiyazRsvp(targets, familyId, entries, { ...opts, respectNotAttending: true });
  return { updated, grid: await getFamilyNiyazGrid(familyId) };
}

// Individual RSVP: records only the one responding mumin (their explicit answer overrides the
// not_attending flag). `familyId` is stored for grouping.
export async function setMuminNiyazRsvp(
  muminId: string,
  familyId: string | null,
  entries: NiyazRsvpEntry[],
  opts: { source: "whatsapp" | "admin"; phone?: string | null; recordedBy?: string | null },
): Promise<ApplyResult> {
  const updated = await applyNiyazRsvp([{ muminId, notAttending: false }], familyId, entries, { ...opts, respectNotAttending: false });
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

// Record a whole-family head count for a date (applies to every event that day). One number = the
// day's total attending heads from that family. Upserts per (event, family).
export async function recordFamilyHeadCount(
  familyId: string,
  date: string,
  headCount: number,
  phone?: string | null,
): Promise<number> {
  const events = (await getEvents()).filter((e) => e.eventDate === date);
  if (events.length === 0) return 0;
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
  return rows.length;
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
      rsvpCount: totalYes + headcountHeads,
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
