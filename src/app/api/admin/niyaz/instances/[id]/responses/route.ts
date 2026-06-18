import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { getEventTallies, getFamilyHeadCounts, type TallyMode } from "@/lib/rsvp/meal-rsvp";
import { assembleBreakdown, type BreakdownRpcRow } from "@/lib/rsvp/niyaz-breakdown";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { fetchAllRows, type Pageable } from "@/lib/whatsapp/audience";

export const runtime = "nodejs";

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

type UnregDbRow = {
  id: string;
  phone_e164: string;
  attending: boolean;
  adults: number;
  kids: number;
  its_number: string | null;
  source: string;
  created_at: string;
};

const REG_SELECT =
  "id, mumin_id, family_id, attending, source, responded_by_phone, recorded_by, updated_at, " +
  "mumin:mumineen!niyaz_rsvp_mumin_id_fkey(full_name, its, is_adult, local_mehman), " +
  "family:families!niyaz_rsvp_family_id_fkey(hof_its)";

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

  // Page the per-mumin and unregistered lists past PostgREST's 1000-row db-max-rows cap (an event can
  // have several thousand niyaz_rsvp rows). Page on a stable id order, then sort for display below, so
  // search/filters in the UI cover the whole event — not just the most-recent 1000.
  const [tallies, rows, unregRows, breakdownResult] = await Promise.all([
    getEventTallies(mode),
    fetchAllRows<ResponseRow>(
      () =>
        supabase
          .from("niyaz_rsvp")
          .select(REG_SELECT)
          .eq("registration_instance_id", id)
          .order("id", { ascending: true }) as unknown as Pageable<ResponseRow>,
    ),
    fetchAllRows<UnregDbRow>(
      () =>
        supabase
          .from("unregistered_rsvps")
          .select("id, phone_e164, attending, adults, kids, its_number, source, created_at")
          .eq("registration_instance_id", id)
          .order("id", { ascending: true }) as unknown as Pageable<UnregDbRow>,
    ),
    // Local-vs-Mehmaan breakdown, DB-aggregated so it is correct past the row list's 1000-row cap.
    supabase.rpc("niyaz_event_breakdown", { p_instance_id: id }),
  ]);

  const tally = tallies.find((t) => t.id === id);
  if (!tally) {
    return NextResponse.json({ error: "Niyaz event not found." }, { status: 404 });
  }

  // Display order: most recently updated first (paging above used a stable id order).
  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  unregRows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  // Eligible-to-RSVP breakdown from the DB aggregate (NOT counted from `rows`, which the db-max-rows
  // cap truncates at 1000). Confirmation-based (whatsapp/admin), so it is mode-independent.
  const breakdown = assembleBreakdown((breakdownResult.data ?? []) as BreakdownRpcRow[]);

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
    unregistered: unregRows,
    headcounts,
  });
}
