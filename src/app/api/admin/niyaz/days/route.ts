import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DayRow = {
  event_date: string;
  rsvp_event_title: string | null;
  lunch_menu: string | null;
  dinner_menu: string | null;
  rsvp_end_time: string | null;
  has_lunch: boolean;
  has_dinner: boolean;
  template_code: string | null;
};

// GET — the configured Niyaz days (niyaz_event_config), each with a representative registration
// instance id for that date (used to drive the RSVP broadcast). Ordered by date.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const db = getSupabaseAdmin();
  const { data: dayData } = await db
    .from("niyaz_event_config")
    .select("event_date, rsvp_event_title, lunch_menu, dinner_menu, rsvp_end_time, has_lunch, has_dinner, template_code")
    .order("event_date", { ascending: true });
  const rows = (dayData ?? []) as DayRow[];

  // A representative registration instance per date (any meal) so a day can preview/send the RSVP
  // broadcast (the broadcast route is instance-keyed; the day maps to it by date).
  const instByDate = new Map<string, string>();
  if (rows.length > 0) {
    const { data: instances } = await db
      .from("rsvp_registration_instance")
      .select("id, event_date, meal")
      .in("event_date", rows.map((d) => d.event_date))
      .order("meal", { ascending: true });
    for (const i of (instances ?? []) as { id: string; event_date: string }[]) {
      if (!instByDate.has(i.event_date)) instByDate.set(i.event_date, i.id);
    }
  }

  return NextResponse.json({
    days: rows.map((d) => ({
      date: d.event_date,
      title: d.rsvp_event_title,
      lunch_menu: d.lunch_menu,
      dinner_menu: d.dinner_menu,
      rsvp_end_time: d.rsvp_end_time,
      has_lunch: d.has_lunch,
      has_dinner: d.has_dinner,
      template_code: d.template_code,
      instance_id: instByDate.get(d.event_date) ?? null,
    })),
  });
}
