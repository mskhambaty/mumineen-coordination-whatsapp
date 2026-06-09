import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

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
  mumin: { full_name: string | null; its: string | null; is_adult: boolean | null } | null;
  family: { hof_its: string | null } | null;
};

// GET /api/admin/niyaz/instances/[id]/responses — per-mumin niyaz_rsvp rows for the event + a summary.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("niyaz_rsvp")
    .select(
      "id, mumin_id, family_id, attending, source, responded_by_phone, recorded_by, updated_at, " +
        "mumin:mumineen!niyaz_rsvp_mumin_id_fkey(full_name, its, is_adult), " +
        "family:families!niyaz_rsvp_family_id_fkey(hof_its)",
    )
    .eq("registration_instance_id", id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as ResponseRow[];
  const isAdult = (r: ResponseRow) => r.mumin?.is_adult !== false; // null counts as adult
  const attending = rows.filter((r) => r.attending);
  const notAttending = rows.filter((r) => !r.attending);

  return NextResponse.json({
    responses: rows,
    summary: {
      responded: rows.length,
      yes_adults: attending.filter(isAdult).length,
      yes_kids: attending.filter((r) => !isAdult(r)).length,
      yes_families: new Set(attending.map((r) => r.family_id)).size,
      no_adults: notAttending.filter(isAdult).length,
      no_kids: notAttending.filter((r) => !isAdult(r)).length,
      no_families: new Set(notAttending.map((r) => r.family_id)).size,
    },
  });
}
