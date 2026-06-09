import { NextRequest, NextResponse } from "next/server";

import { canAccessMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET: roster summary stats for the admin page.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;
  const supabase = getSupabaseAdmin();

  const [mumineen, adults, families, registeredFamilies, mehmaan, local] = await Promise.all([
    supabase.from("mumineen").select("id", { count: "exact", head: true }).eq("roster_active", true),
    supabase.from("mumineen").select("id", { count: "exact", head: true }).eq("roster_active", true).eq("is_adult", true),
    supabase.from("families").select("id", { count: "exact", head: true }).eq("roster_active", true),
    supabase.from("families").select("id", { count: "exact", head: true }).eq("roster_active", true).eq("registration_status", "submitted"),
    supabase.from("mumineen").select("id", { count: "exact", head: true }).eq("roster_active", true).eq("local_mehman", "Mehman"),
    supabase.from("mumineen").select("id", { count: "exact", head: true }).eq("roster_active", true).eq("local_mehman", "Local"),
  ]);

  return NextResponse.json({
    mumineen: mumineen.count ?? 0,
    adults: adults.count ?? 0,
    families: families.count ?? 0,
    registered_families: registeredFamilies.count ?? 0,
    mehmaan: mehmaan.count ?? 0,
    local: local.count ?? 0,
  });
}
