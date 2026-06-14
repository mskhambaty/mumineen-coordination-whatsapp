import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await getSupabaseAdmin()
    .from("lost_found_reports")
    .select("id, report_type, status, item_name, description, category, color, brand, location, occurred_at, reporter_name, reporter_phone_e164, reporter_its, escalation_status, escalated_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Could not load lost-and-found reports" }, { status: 500 });
  }
  return NextResponse.json({ reports: data ?? [] });
}
