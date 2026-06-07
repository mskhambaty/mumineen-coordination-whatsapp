import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/templates/broadcasts — the send log with per-broadcast metrics (most recent first).
// Admin/leadership only.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await getSupabaseAdmin()
    .from("template_broadcasts")
    .select(
      "id, template_code, audience_key, status, total_recipients, count_free, count_paid, count_sent, count_failed, est_cost_usd, started_at, finished_at",
    )
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ broadcasts: data ?? [] });
}
