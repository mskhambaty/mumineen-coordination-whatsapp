import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { dateStr, nonNegInt, oneOf, str } from "@/lib/registration/normalize";
import { getEventTallies, type TallyMode } from "@/lib/rsvp/meal-rsvp";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEALS = ["lunch", "dinner"] as const;
const SERVING_TYPES = ["thaal", "packet"] as const;

type InstanceBody = {
  title?: unknown;
  event_date?: unknown;
  hijri_date?: unknown;
  meal?: unknown;
  serving_type?: unknown;
  description?: unknown;
  thaal_wardi_count?: unknown;
  actual_count?: unknown;
};

// GET /api/admin/niyaz/instances — Niyaz events ordered by date, each with per-event attendance
// tallies (yes/no split by adult/kid/family + thaal count), from the niyaz_event_tallies view.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  try {
    const mode: TallyMode = req.nextUrl.searchParams.get("mode") === "min" ? "min" : "max";
    const instances = await getEventTallies(mode);
    return NextResponse.json({ instances });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load events" }, { status: 500 });
  }
}

// POST /api/admin/niyaz/instances — create a Niyaz event (day + meal + serving type).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as InstanceBody;
  const title = str(body.title);
  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rsvp_registration_instance")
    .insert({
      title,
      status: "open",
      event_date: dateStr(body.event_date),
      hijri_date: str(body.hijri_date),
      meal: oneOf(body.meal, MEALS),
      serving_type: oneOf(body.serving_type, SERVING_TYPES),
      description: str(body.description),
      thaal_wardi_count: nonNegInt(body.thaal_wardi_count),
      actual_count: nonNegInt(body.actual_count),
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ instance: data }, { status: 201 });
}
