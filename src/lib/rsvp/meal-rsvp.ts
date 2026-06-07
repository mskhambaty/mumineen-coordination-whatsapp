import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveFamilyForPhone } from "@/lib/rsvp/family";

// Meal-RSVP domain over the reused RSVP tables: each rsvp_registration_instance row with a
// (event_date, meal) is one meal slot; each rsvp_responses row is a family's latest answer for
// a slot (head_count = number attending that meal). One updatable row per submitter per slot,
// latest-wins — matching the existing rsvp_responses shape.

export type Meal = "lunch" | "dinner";

export type MealSlot = {
  id: string;
  eventDate: string; // YYYY-MM-DD
  meal: Meal;
  servingType: string | null; // 'thaal' | 'packet'
  status: string;
};

export type MealGridRow = MealSlot & {
  attending: boolean | null; // null = no response yet
  headCount: number | null;
};

// One instruction from the agent: set a meal for specific dates (or all dates of that meal).
export type MealRsvpEntry = {
  meal: Meal;
  attending: boolean;
  headCount?: number | null;
  dates?: string[]; // specific YYYY-MM-DD days; omit (or all=true) to apply to every slot of this meal
  all?: boolean;
};

// All seeded meal slots, ordered by day then meal.
export async function getMealSlots(): Promise<MealSlot[]> {
  const { data } = await getSupabaseAdmin()
    .from("rsvp_registration_instance")
    .select("id, event_date, meal, serving_type, status")
    .not("event_date", "is", null)
    .not("meal", "is", null)
    .order("event_date", { ascending: true })
    .order("meal", { ascending: true });

  return ((data ?? []) as RawSlot[]).map(toSlot);
}

type RawSlot = { id: string; event_date: string; meal: Meal; serving_type: string | null; status: string };
const toSlot = (r: RawSlot): MealSlot => ({
  id: r.id,
  eventDate: r.event_date,
  meal: r.meal,
  servingType: r.serving_type,
  status: r.status,
});

// The family's current grid: every meal slot, merged with the family's latest response (if any).
export async function getFamilyMealGrid(familyId: string): Promise<MealGridRow[]> {
  const slots = await getMealSlots();

  const { data: responses } = await getSupabaseAdmin()
    .from("rsvp_responses")
    .select("registration_instance_id, response, head_count, submitted_at")
    .eq("family_id", familyId)
    .order("submitted_at", { ascending: false });

  // Latest response per instance (rows already sorted newest-first).
  const latestByInstance = new Map<string, { response: string | null; head_count: number | null }>();
  for (const row of (responses ?? []) as { registration_instance_id: string; response: string | null; head_count: number | null }[]) {
    if (!latestByInstance.has(row.registration_instance_id)) {
      latestByInstance.set(row.registration_instance_id, { response: row.response, head_count: row.head_count });
    }
  }

  return slots.map((slot) => {
    const r = latestByInstance.get(slot.id);
    return {
      ...slot,
      attending: r ? r.response === "yes" : null,
      headCount: r ? r.head_count : null,
    };
  });
}

export type MealGridTotal = {
  instanceId: string;
  eventDate: string;
  meal: Meal;
  servingType: string | null;
  respondedFamilies: number;
  attendingFamilies: number;
  totalHeadCount: number;
};

// Per-slot kitchen totals across all families: how many families responded, how many are attending,
// and the summed head count — using each family's latest response per slot.
export async function getMealGridTotals(): Promise<MealGridTotal[]> {
  const slots = await getMealSlots();
  if (slots.length === 0) return [];

  const { data } = await getSupabaseAdmin()
    .from("rsvp_responses")
    .select("registration_instance_id, family_id, response, head_count, submitted_at")
    .in(
      "registration_instance_id",
      slots.map((s) => s.id),
    )
    .order("submitted_at", { ascending: false });

  // Latest response per (instance, family).
  const seen = new Set<string>();
  const agg = new Map<string, { responded: number; attending: number; head: number }>();
  for (const s of slots) agg.set(s.id, { responded: 0, attending: 0, head: 0 });

  for (const r of (data ?? []) as { registration_instance_id: string; family_id: string; response: string | null; head_count: number | null }[]) {
    const key = `${r.registration_instance_id}|${r.family_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = agg.get(r.registration_instance_id);
    if (!a) continue;
    a.responded++;
    if (r.response === "yes") {
      a.attending++;
      a.head += r.head_count ?? 0;
    }
  }

  return slots.map((s) => {
    const a = agg.get(s.id)!;
    return {
      instanceId: s.id,
      eventDate: s.eventDate,
      meal: s.meal,
      servingType: s.servingType,
      respondedFamilies: a.responded,
      attendingFamilies: a.attending,
      totalHeadCount: a.head,
    };
  });
}

// Record (or update) one family's RSVP for one meal slot, latest-wins per submitter. Rebuilds the
// behavior of the former niyaz/record helper against the intact rsvp_responses table.
export async function recordMealRsvp(input: {
  instanceId: string;
  familyId: string;
  muminId?: string | null;
  attending: boolean;
  headCount?: number | null;
  source: "whatsapp" | "admin";
  phone?: string | null;
  recordedBy?: string | null;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const fields = {
    registration_instance_id: input.instanceId,
    family_id: input.familyId,
    submitted_by_mumin_id: input.muminId ?? null,
    response: input.attending ? "yes" : "no",
    head_count: input.attending ? (input.headCount ?? null) : 0,
    source: input.source,
    recorded_by: input.recordedBy ?? null,
    responded_by_phone: input.phone ?? null,
    submitted_at: new Date().toISOString(),
  };

  // Keep one updatable row per identified submitter per slot.
  if (input.muminId) {
    const { data: existing } = await supabase
      .from("rsvp_responses")
      .select("id")
      .eq("registration_instance_id", input.instanceId)
      .eq("submitted_by_mumin_id", input.muminId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase.from("rsvp_responses").update(fields).eq("id", existing.id);
      if (error) throw new Error(error.message);
      return;
    }
  }

  const { error } = await supabase.from("rsvp_responses").insert(fields);
  if (error) throw new Error(error.message);
}

export type ApplyResult = { updated: number; grid: MealGridRow[] };

// Apply a batch of agent-parsed RSVP entries for the family owning `phone`, then return the
// refreshed grid. Entries with no `dates` (or all=true) apply to every slot of that meal.
export async function applyMealRsvps(
  phone: string,
  entries: MealRsvpEntry[],
  opts: { source: "whatsapp" | "admin"; recordedBy?: string | null } = { source: "whatsapp" },
): Promise<ApplyResult | { error: string }> {
  const family = await resolveFamilyForPhone(phone);
  if (!family) return { error: "no_family_for_phone" };

  const slots = await getMealSlots();
  const byKey = new Map<string, MealSlot>();
  for (const s of slots) byKey.set(`${s.eventDate}|${s.meal}`, s);

  let updated = 0;
  for (const entry of entries) {
    const targetDates =
      entry.all || !entry.dates || entry.dates.length === 0
        ? slots.filter((s) => s.meal === entry.meal).map((s) => s.eventDate)
        : entry.dates;

    for (const date of targetDates) {
      const slot = byKey.get(`${date}|${entry.meal}`);
      if (!slot) continue; // ignore dates outside the seeded grid
      await recordMealRsvp({
        instanceId: slot.id,
        familyId: family.familyId,
        muminId: family.muminId,
        attending: entry.attending,
        headCount: entry.headCount ?? null,
        source: opts.source,
        phone,
        recordedBy: opts.recordedBy ?? null,
      });
      updated++;
    }
  }

  return { updated, grid: await getFamilyMealGrid(family.familyId) };
}
