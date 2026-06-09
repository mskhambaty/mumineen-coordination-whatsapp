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
  meal: Meal | null;
  servingType: string | null; // 'thaal' | 'packet'
  description: string | null;
};

type RawEvent = {
  id: string;
  title: string | null;
  event_date: string;
  meal: Meal | null;
  serving_type: string | null;
  description: string | null;
};
const toEvent = (r: RawEvent): NiyazEvent => ({
  id: r.id,
  title: r.title ?? "",
  eventDate: r.event_date,
  meal: r.meal,
  servingType: r.serving_type,
  description: r.description,
});

// All Niyaz events (instances with an event_date), ordered by day then meal.
export async function getEvents(): Promise<NiyazEvent[]> {
  const { data } = await getSupabaseAdmin()
    .from("rsvp_registration_instance")
    .select("id, title, event_date, meal, serving_type, description")
    .not("event_date", "is", null)
    .order("event_date", { ascending: true })
    .order("meal", { ascending: true });
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

// Apply RSVP changes for the family owning `familyId`. Cascades to ALL roster_active family members
// for each matched event; a "yes" never flips a member flagged not_attending. Upserts overwrite the
// per-mumin row (whatsapp/admin override the arrival-date default). Returns the refreshed grid.
export async function setFamilyNiyazRsvp(
  familyId: string,
  entries: NiyazRsvpEntry[],
  opts: { source: "whatsapp" | "admin"; phone?: string | null; recordedBy?: string | null },
): Promise<ApplyResult> {
  const supabase = getSupabaseAdmin();
  const events = await getEvents();

  // Last entry wins per event.
  const decisions = new Map<string, boolean>();
  for (const entry of entries) {
    const dateSet = entry.all || !entry.dates || entry.dates.length === 0 ? null : new Set(entry.dates);
    for (const ev of events) {
      if (dateSet && !dateSet.has(ev.eventDate)) continue;
      if (entry.meal && ev.meal !== entry.meal) continue;
      decisions.set(ev.id, entry.attending);
    }
  }
  if (decisions.size === 0) return { updated: 0, grid: await getFamilyNiyazGrid(familyId) };

  const { data: members } = await supabase
    .from("mumineen")
    .select("id, not_attending")
    .eq("family_id", familyId)
    .eq("roster_active", true);
  const memberList = (members ?? []) as { id: string; not_attending: boolean }[];

  const rows: Record<string, unknown>[] = [];
  for (const [instanceId, attending] of decisions) {
    for (const m of memberList) {
      if (attending && m.not_attending) continue; // don't pull a not-attending member into a "yes"
      rows.push({
        registration_instance_id: instanceId,
        mumin_id: m.id,
        family_id: familyId,
        attending,
        source: opts.source,
        responded_by_phone: opts.phone ?? null,
        recorded_by: opts.recordedBy ?? null,
      });
    }
  }

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from("niyaz_rsvp")
        .upsert(rows.slice(i, i + 500), { onConflict: "registration_instance_id,mumin_id" });
      if (error) throw new Error(error.message);
    }
  }

  return { updated: rows.length, grid: await getFamilyNiyazGrid(familyId) };
}

export type EventTally = NiyazEvent & {
  yesAdults: number;
  yesKids: number;
  yesFamilies: number;
  thaalCount: number;
  noAdults: number;
  noKids: number;
  noFamilies: number;
};

// Per-event attendance tallies for the admin page, from the niyaz_event_tallies view.
export async function getEventTallies(): Promise<EventTally[]> {
  const events = await getEvents();
  const { data } = await getSupabaseAdmin()
    .from("niyaz_event_tallies")
    .select("instance_id, yes_adults, yes_kids, yes_families, thaal_count, no_adults, no_kids, no_families");

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
  const byId = new Map<string, Row>();
  for (const r of (data ?? []) as Row[]) byId.set(r.instance_id, r);

  return events.map((event) => {
    const t = byId.get(event.id);
    return {
      ...event,
      yesAdults: Number(t?.yes_adults ?? 0),
      yesKids: Number(t?.yes_kids ?? 0),
      yesFamilies: Number(t?.yes_families ?? 0),
      thaalCount: Number(t?.thaal_count ?? 0),
      noAdults: Number(t?.no_adults ?? 0),
      noKids: Number(t?.no_kids ?? 0),
      noFamilies: Number(t?.no_families ?? 0),
    };
  });
}

// Attending head counts for one calendar day, split by meal — for the nightly department digest.
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
