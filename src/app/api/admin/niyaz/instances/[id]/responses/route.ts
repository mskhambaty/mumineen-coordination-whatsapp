import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { getEventTallies, getFamilyHeadCounts, type TallyMode } from "@/lib/rsvp/meal-rsvp";
import { assembleBreakdown, type BreakdownRpcRow } from "@/lib/rsvp/niyaz-breakdown";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

// PostgREST caps an unbounded select at 1000 rows; an event can have several thousand niyaz_rsvp
// rows, so request the full set explicitly. (Headline Yes/No come from the aggregate, not this list,
// but the displayed list must not be silently truncated either.)
const ROW_LIMIT = 99999;

// Shape returned to the admin event-detail table: one per-mumin RSVP row for this event.
type ResponseRow = {
  id: string;
  mumin_id: string;
  family_id: string | null;
  attending: boolean;
  source: string;
  responded_by_phone: string | null;
  recorded_by: string | null;
  updated_at: string;
  mumin: { full_name: string | null; its: string | null; is_adult: boolean | null; local_mehman: string | null } | null;
  family: { hof_its: string | null } | null;
};

// GET /api/admin/niyaz/instances/[id]/responses?mode=min|max
// Per-mumin niyaz_rsvp rows + unregistered RSVPs + family head-counts for the event, plus the event
// meta and a mode-aware Yes/No tally. Counts come from getEventTallies (DB-aggregated, never row-
// capped) so they match the admin days overview exactly — NOT from counting the fetched rows.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const mode: TallyMode = req.nextUrl.searchParams.get("mode") === "max" ? "max" : "min";

  const [tallies, regResult, unregResult, breakdownResult] = await Promise.all([
    getEventTallies(mode),
    supabase
      .from("niyaz_rsvp")
      .select(
        "id, mumin_id, family_id, attending, source, responded_by_phone, recorded_by, updated_at, " +
          "mumin:mumineen!niyaz_rsvp_mumin_id_fkey(full_name, its, is_adult, local_mehman), " +
          "family:families!niyaz_rsvp_family_id_fkey(hof_its)",
      )
      .eq("registration_instance_id", id)
      .order("updated_at", { ascending: false })
      .range(0, ROW_LIMIT),
    supabase
      .from("unregistered_rsvps")
      .select("id, phone_e164, attending, adults, kids, its_number, source, created_at")
      .eq("registration_instance_id", id)
      .order("created_at", { ascending: false })
      .range(0, ROW_LIMIT),
    // Local-vs-Mehmaan breakdown, DB-aggregated so it is correct past the row list's 1000-row cap.
    supabase.rpc("niyaz_event_breakdown", { p_instance_id: id }),
  ]);

  const tally = tallies.find((t) => t.id === id);
  if (!tally) {
    return NextResponse.json({ error: "Niyaz event not found." }, { status: 404 });
  }
  if (regResult.error) {
    return NextResponse.json({ error: regResult.error.message }, { status: 500 });
  }

  const rows = (regResult.data ?? []) as unknown as ResponseRow[];

  // Local-vs-Mehmaan breakdown from the DB aggregate (NOT counted from `rows`, which the db-max-rows
  // cap truncates at 1000). assembleBreakdown picks the columns for the active mode.
  const breakdown = assembleBreakdown((breakdownResult.data ?? []) as BreakdownRpcRow[], mode);

  // Free-text family head counts for this event (separate input from the per-mumin button responses).
  const headcounts = await getFamilyHeadCounts(id);

  return NextResponse.json({
    instance: {
      id: tally.id,
      title: tally.title,
      event_date: tally.eventDate,
      hijri_date: tally.hijriDate,
      meal: tally.meal,
      serving_type: tally.servingType,
    },
    // Mode-aware aggregate (matches the admin days overview). Yes/No are registered attending heads.
    tally: {
      mode,
      yes: tally.yesAdults + tally.yesKids,
      no: tally.noAdults + tally.noKids,
      yesAdults: tally.yesAdults,
      yesKids: tally.yesKids,
      noAdults: tally.noAdults,
      noKids: tally.noKids,
      yesFamilies: tally.yesFamilies,
      noFamilies: tally.noFamilies,
    },
    breakdown,
    responses: rows,
    unregistered: (unregResult.data ?? []).map((u) => ({
      id: u.id,
      phone_e164: u.phone_e164,
      attending: u.attending,
      adults: u.adults,
      kids: u.kids,
      its_number: u.its_number,
      source: u.source,
      created_at: u.created_at,
    })),
    headcounts,
  });
}
