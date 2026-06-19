import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchAllRows, type Pageable } from "@/lib/whatsapp/audience";

export const runtime = "nodejs";

// One row per eligible-to-RSVP member for the admin event-detail "By Individual" view. Derived from
// the niyaz_event_individual_grid DB aggregate (same eligible population as the Breakdown panel),
// left-joined to niyaz_rsvp so members with no row still appear as "no response" — see the matching
// migration. `whatsapp` is the member's contact number for the CSV export.
export type IndividualGridRow = {
  mumin_id: string;
  its: string | null;
  full_name: string | null;
  is_adult: boolean | null;
  local_mehman: string | null;
  hof_its: string | null;
  whatsapp: string | null;
  attending: boolean | null;
  source: string | null;
  responded_by: string | null;
  updated_at: string | null;
  responded: boolean;
};

// GET /api/admin/niyaz/instances/[id]/individuals
// Per-member RSVP grid for the event. The aggregate returns one row per eligible member (a few
// thousand on a large event), past PostgREST's 1000-row db-max-rows cap, so it is PAGED via
// fetchAllRows (stable order by mumin_id) — never a single truncated query.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const individuals = await fetchAllRows<IndividualGridRow>(
    () =>
      supabase
        .rpc("niyaz_event_individual_grid", { p_instance_id: id })
        .order("mumin_id", { ascending: true }) as unknown as Pageable<IndividualGridRow>,
  );

  return NextResponse.json({ individuals });
}
