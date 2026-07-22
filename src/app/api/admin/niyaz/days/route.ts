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

  // The registration instances for each date (the per-meal rows shown under the day). The first is
  // the representative used to preview/send the RSVP broadcast (the broadcast route is instance-keyed;
  // the day maps to it by date).
  type Inst = { id: string; title: string | null; meal: string | null; serving_type: string | null };
  const instByDate = new Map<string, Inst[]>();
  if (rows.length > 0) {
    const { data: instances } = await db
      .from("rsvp_registration_instance")
      .select("id, event_date, title, meal, serving_type")
      .in("event_date", rows.map((d) => d.event_date))
      .order("meal", { ascending: true });
    for (const i of (instances ?? []) as (Inst & { event_date: string })[]) {
      const arr = instByDate.get(i.event_date) ?? [];
      arr.push({ id: i.id, title: i.title, meal: i.meal, serving_type: i.serving_type });
      instByDate.set(i.event_date, arr);
    }
  }

  return NextResponse.json({
    days: rows.map((d) => {
      const instances = instByDate.get(d.event_date) ?? [];
      return {
        date: d.event_date,
        title: d.rsvp_event_title,
        lunch_menu: d.lunch_menu,
        dinner_menu: d.dinner_menu,
        rsvp_end_time: d.rsvp_end_time,
        has_lunch: d.has_lunch,
        has_dinner: d.has_dinner,
        template_code: d.template_code,
        instances,
        instance_id: instances[0]?.id ?? null,
      };
    }),
  });
}
