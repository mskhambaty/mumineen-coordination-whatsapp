import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/server";

// Day-level Niyaz event configuration (niyaz_event_config), keyed by event_date. Holds the
// template-facing, admin-editable fields the daily RSVP broadcast needs — event title, lunch/dinner
// menus, RSVP cutoff time, which meals are offered, and which template to send. The per-meal
// rsvp_registration_instance rows stay the RSVP/tally source of truth; this only decorates a day.

export type NiyazEventConfig = {
  eventDate: string;
  dayId: number | null;
  rsvpEventTitle: string | null;
  lunchMenu: string | null;
  dinnerMenu: string | null;
  rsvpEndTime: string | null;
  hasLunch: boolean;
  hasDinner: boolean;
  templateCode: string | null;
};

type Row = {
  event_date: string;
  day_id: number | null;
  rsvp_event_title: string | null;
  lunch_menu: string | null;
  dinner_menu: string | null;
  rsvp_end_time: string | null;
  has_lunch: boolean;
  has_dinner: boolean;
  template_code: string | null;
};

const COLS = "event_date, day_id, rsvp_event_title, lunch_menu, dinner_menu, rsvp_end_time, has_lunch, has_dinner, template_code";

const toConfig = (r: Row): NiyazEventConfig => ({
  eventDate: r.event_date,
  dayId: r.day_id,
  rsvpEventTitle: r.rsvp_event_title,
  lunchMenu: r.lunch_menu,
  dinnerMenu: r.dinner_menu,
  rsvpEndTime: r.rsvp_end_time,
  hasLunch: r.has_lunch,
  hasDinner: r.has_dinner,
  templateCode: r.template_code,
});

export const eventConfigPatchSchema = z.object({
  rsvp_event_title: z.string().nullable().optional(),
  lunch_menu: z.string().nullable().optional(),
  dinner_menu: z.string().nullable().optional(),
  rsvp_end_time: z.string().nullable().optional(),
  has_lunch: z.boolean().optional(),
  has_dinner: z.boolean().optional(),
  template_code: z.string().nullable().optional(),
});
export type EventConfigPatch = z.infer<typeof eventConfigPatchSchema>;

// The day's config, or null if none has been saved yet.
export async function getEventConfig(date: string): Promise<NiyazEventConfig | null> {
  const { data } = await getSupabaseAdmin()
    .from("niyaz_event_config")
    .select(COLS)
    .eq("event_date", date)
    .maybeSingle();
  return data ? toConfig(data as Row) : null;
}

// The day's config by its stable numeric day_id (used to decode the Flow's registration_instance_id).
export async function getEventConfigByDayId(dayId: number): Promise<NiyazEventConfig | null> {
  if (!Number.isFinite(dayId)) return null;
  const { data } = await getSupabaseAdmin()
    .from("niyaz_event_config")
    .select(COLS)
    .eq("day_id", dayId)
    .maybeSingle();
  return data ? toConfig(data as Row) : null;
}

// Upsert a day's config. Only provided fields are written (partial patch) so a single-field edit
// doesn't clobber the others.
export async function upsertEventConfig(date: string, patch: EventConfigPatch): Promise<NiyazEventConfig> {
  const db = getSupabaseAdmin();

  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.rsvp_event_title !== undefined) fields.rsvp_event_title = patch.rsvp_event_title;
  if (patch.lunch_menu !== undefined) fields.lunch_menu = patch.lunch_menu;
  if (patch.dinner_menu !== undefined) fields.dinner_menu = patch.dinner_menu;
  if (patch.rsvp_end_time !== undefined) fields.rsvp_end_time = patch.rsvp_end_time;
  if (patch.has_lunch !== undefined) fields.has_lunch = patch.has_lunch;
  if (patch.has_dinner !== undefined) fields.has_dinner = patch.has_dinner;
  if (patch.template_code !== undefined) fields.template_code = patch.template_code;

  const existing = await db.from("niyaz_event_config").select("event_date").eq("event_date", date).maybeSingle();
  if (existing.data) {
    const { data, error } = await db.from("niyaz_event_config").update(fields).eq("event_date", date).select(COLS).single();
    if (error) throw new Error(error.message);
    return toConfig(data as Row);
  }
  const { data, error } = await db.from("niyaz_event_config").insert({ event_date: date, ...fields }).select(COLS).single();
  if (error) throw new Error(error.message);
  return toConfig(data as Row);
}
