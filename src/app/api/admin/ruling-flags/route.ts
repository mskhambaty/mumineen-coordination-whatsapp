import { NextRequest, NextResponse } from "next/server";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

type Row = {
  phone_e164: string;
  message: string;
  detected_by: string;
  reviewed: boolean;
  created_at: string;
};

// GET /api/admin/ruling-flags — awareness view of personal-ruling (fatwa) questions the bot
// refused and flagged (NOT escalations). Counts + the most recent questions, so the team can see
// what's being asked. Admin/leadership or a religious monitor. Phone is masked to the last 4 digits.
// Optional ?from=YYYY-MM-DD floors by date (e.g. "Since Ashara") so pre-event TEST flags are
// excluded from the counts WITHOUT deleting any rows.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const from = req.nextUrl.searchParams.get("from");
  let query = getSupabaseAdmin()
    .from("religious_ruling_flags")
    .select("phone_e164, message, detected_by, reviewed, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  return NextResponse.json({
    total: rows.length,
    unreviewed: rows.filter((r) => !r.reviewed).length,
    recent: rows.slice(0, 30).map((r) => ({
      phone_last4: r.phone_e164.slice(-4),
      message: r.message,
      detected_by: r.detected_by,
      reviewed: r.reviewed,
      created_at: r.created_at,
    })),
  });
}
