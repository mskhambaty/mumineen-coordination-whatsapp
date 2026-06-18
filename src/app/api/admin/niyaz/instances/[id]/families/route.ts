import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchAllRows, type Pageable } from "@/lib/whatsapp/audience";

export const runtime = "nodejs";

// One row per roster-active family for the admin event-detail "By Family" view. Derived from the
// niyaz_event_family_grid DB aggregate (whether the family responded, the attending headcount they
// gave, guest count, and when/by whom — see the matching migration).
export type FamilyGridRow = {
  family_id: string;
  hof_its: string;
  hof_name: string;
  responded: boolean;
  attending: number;
  guests: number;
  responded_at: string | null;
  responded_by: string | null;
};

// GET /api/admin/niyaz/instances/[id]/families
// Family-level RSVP grid for the event. The aggregate returns ~1.1k rows (one per roster-active
// family), past PostgREST's 1000-row db-max-rows cap, so it is PAGED via fetchAllRows (stable order
// by family_id) — never a single truncated query.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const families = await fetchAllRows<FamilyGridRow>(
    () =>
      supabase
        .rpc("niyaz_event_family_grid", { p_instance_id: id })
        .order("family_id", { ascending: true }) as unknown as Pageable<FamilyGridRow>,
  );

  return NextResponse.json({ families });
}
