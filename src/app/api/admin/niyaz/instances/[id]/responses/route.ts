import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { getFamilyHeadCounts } from "@/lib/rsvp/meal-rsvp";
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

  const [regResult, unregResult] = await Promise.all([
    supabase
      .from("niyaz_rsvp")
      .select(
        "id, mumin_id, family_id, attending, source, responded_by_phone, recorded_by, updated_at, " +
          "mumin:mumineen!niyaz_rsvp_mumin_id_fkey(full_name, its, is_adult), " +
          "family:families!niyaz_rsvp_family_id_fkey(hof_its)",
      )
      .eq("registration_instance_id", id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("unregistered_rsvps")
      .select("id, phone_e164, attending, adults, kids, its_number, source, created_at")
      .eq("registration_instance_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (regResult.error) {
    return NextResponse.json({ error: regResult.error.message }, { status: 500 });
  }

  const rows = (regResult.data ?? []) as unknown as ResponseRow[];
  const isAdult = (r: ResponseRow) => r.mumin?.is_adult !== false; // null counts as adult
  const attending = rows.filter((r) => r.attending);
  const notAttending = rows.filter((r) => !r.attending);

  // Free-text family head counts for this event (separate input from the per-mumin button responses).
  const headcounts = await getFamilyHeadCounts(id);
  const headcountTotal = headcounts.reduce((sum, h) => sum + (h.head_count ?? 0), 0);

  return NextResponse.json({
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
    summary: {
      responded: rows.length,
      yes_adults: attending.filter(isAdult).length,
      yes_kids: attending.filter((r) => !isAdult(r)).length,
      yes_families: new Set(attending.map((r) => r.family_id)).size,
      no_adults: notAttending.filter(isAdult).length,
      no_kids: notAttending.filter((r) => !isAdult(r)).length,
      no_families: new Set(notAttending.map((r) => r.family_id)).size,
      headcount_families: headcounts.length,
      headcount_total: headcountTotal,
    },
  });
}
