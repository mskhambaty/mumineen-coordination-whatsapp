import { NextRequest, NextResponse } from "next/server";

import { canAccessMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/mumineen/departments — full department list for the admin khidmat editor.
// Unlike /api/departments (bearer auth, scoped to the caller's own departments), this returns
// every department so an admin can assign any of them when editing a member.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("departments").select("id, name").order("name");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ departments: data ?? [] });
}
