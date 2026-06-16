import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/server";

// Day-level Niyaz event configuration (niyaz_event_config), keyed by event_date. Holds the
// template-facing, admin-editable fields the daily RSVP broadcast needs — event title, lunch/dinner
// menus, RSVP cutoff time, which meals are offered, and which template to send. The per-meal
// rsvp_registration_instance rows stay the RSVP/tally source of truth; this only decorates a day.

// Per-variable binding (static value or roster field) — mirrors @/lib/whatsapp/templates Binding.
type BindingJson = { kind: "static"; value: string } | { kind: "field"; field: string };
// Flat token → binding map (incl. the header token, if any); split into body/header at resolve time.
export type NiyazVariableBindings = Record<string, BindingJson> | null;

export type NiyazEventConfig = {
  eventDate: string;
  dayId: number | null;
  rsvpEventTitle: string | null;
  lunchMenu: string | null;
  dinnerMenu: string | null;
  rsvpEndTime: string | null;
  rsvpEndAt: string | null;
  hasLunch: boolean;
  hasDinner: boolean;
  templateCode: string | null;
  confirmationTemplateCode: string | null;
  confirmationVariableBindings: NiyazVariableBindings;
  confirmationButtons: unknown[] | null;
};

type Row = {
  event_date: string;
  day_id: number | null;
  rsvp_event_title: string | null;
  lunch_menu: string | null;
  dinner_menu: string | null;
  rsvp_end_time: string | null;
  rsvp_end_at: string | null;
  has_lunch: boolean;
  has_dinner: boolean;
  template_code: string | null;
  confirmation_template_code: string | null;
  confirmation_variable_bindings: NiyazVariableBindings;
  confirmation_buttons: unknown[] | null;
};

const COLS =
  "event_date, day_id, rsvp_event_title, lunch_menu, dinner_menu, rsvp_end_time, rsvp_end_at, has_lunch, has_dinner, template_code, confirmation_template_code, confirmation_variable_bindings, confirmation_buttons";

const toConfig = (r: Row): NiyazEventConfig => ({
  eventDate: r.event_date,
  dayId: r.day_id,
  rsvpEventTitle: r.rsvp_event_title,
  lunchMenu: r.lunch_menu,
  dinnerMenu: r.dinner_menu,
  rsvpEndTime: r.rsvp_end_time,
  rsvpEndAt: r.rsvp_end_at,
  hasLunch: r.has_lunch,
  hasDinner: r.has_dinner,
  templateCode: r.template_code,
  confirmationTemplateCode: r.confirmation_template_code,
  confirmationVariableBindings: r.confirmation_variable_bindings ?? null,
  confirmationButtons: r.confirmation_buttons ?? null,
});

export const eventConfigPatchSchema = z.object({
  rsvp_event_title: z.string().nullable().optional(),
  lunch_menu: z.string().nullable().optional(),
  dinner_menu: z.string().nullable().optional(),
  rsvp_end_time: z.string().nullable().optional(),
  rsvp_end_at: z.string().datetime({ offset: true }).nullable().optional(),
  has_lunch: z.boolean().optional(),
  has_dinner: z.boolean().optional(),
  template_code: z.string().nullable().optional(),
  confirmation_template_code: z.string().nullable().optional(),
  // jsonb passthrough (validated structurally at resolve time).
  confirmation_variable_bindings: z.any().nullable().optional(),
  confirmation_buttons: z.array(z.any()).nullable().optional(),
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

// Map of event_date → day-level title (rsvp_event_title) for every configured day. One query, used
// to label the family RSVP summary per DAY (matching the admin "Niyaz days" view) instead of by the
// per-meal instance title, which differs on dinners due to the hijri night-shift. Dates with no
// title are omitted, so callers fall back to the instance title / date.
export async function getEventConfigTitles(): Promise<Map<string, string>> {
  const { data } = await getSupabaseAdmin()
    .from("niyaz_event_config")
    .select("event_date, rsvp_event_title");
  const map = new Map<string, string>();
  for (const r of (data ?? []) as { event_date: string; rsvp_event_title: string | null }[]) {
    if (r.rsvp_event_title) map.set(r.event_date, r.rsvp_event_title);
  }
  return map;
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
  if (patch.rsvp_end_at !== undefined) fields.rsvp_end_at = patch.rsvp_end_at;
  if (patch.has_lunch !== undefined) fields.has_lunch = patch.has_lunch;
  if (patch.has_dinner !== undefined) fields.has_dinner = patch.has_dinner;
  if (patch.template_code !== undefined) fields.template_code = patch.template_code;
  if (patch.confirmation_template_code !== undefined) fields.confirmation_template_code = patch.confirmation_template_code;
  if (patch.confirmation_variable_bindings !== undefined) fields.confirmation_variable_bindings = patch.confirmation_variable_bindings;
  if (patch.confirmation_buttons !== undefined) fields.confirmation_buttons = patch.confirmation_buttons;

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
