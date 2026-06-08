import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

// Shape returned to the admin table: the latest submission per family for this instance.
type ResponseRow = {
  id: string;
  family_id: string;
  submitted_by_mumin_id: string | null;
  response: string | null;
  head_count: number | null;
  responded_by_phone: string | null;
  source: string;
  recorded_by: string | null;
  submitted_at: string;
  created_at: string;
  family: { hof_its: string | null } | null;
  submitter: { its: string | null; full_name: string | null } | null;
};

// GET /api/admin/niyaz/instances/[id]/responses — one row per family (most recent submission).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  // Pull all submissions for the instance, newest first, with family + submitter names embedded.
  const { data, error } = await supabase
    .from("rsvp_responses")
    .select(
      "id, family_id, submitted_by_mumin_id, response, head_count, responded_by_phone, source, recorded_by, submitted_at, created_at, " +
        "family:families!rsvp_responses_family_id_fkey(hof_its), " +
        "submitter:mumineen!rsvp_responses_mumin_id_fkey(its, full_name)",
    )
    .eq("registration_instance_id", id)
    .order("submitted_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Keep only the latest submission per family (the list is already newest-first).
  const rows = (data ?? []) as unknown as ResponseRow[];
  const latest: ResponseRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.family_id)) continue;
    seen.add(r.family_id);
    latest.push(r);
  }

  const responded_families = latest.length;
  const yes = latest.filter((r) => r.response === "yes");
  const total_head_count = yes.reduce((sum, r) => sum + (r.head_count ?? 0), 0);

  return NextResponse.json({
    responses: latest,
    tally: { responded_families, yes_count: yes.length, total_head_count },
  });
}
