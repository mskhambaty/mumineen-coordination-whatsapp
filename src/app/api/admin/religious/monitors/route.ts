import { NextRequest, NextResponse } from "next/server";

import { canMonitorReligiousChats, isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MEMBER_SELECT = "id, created_at, user:whatsapp_users(id, display_name, email, phone_e164)";

// GET: list religious monitors. Visible to any monitor (so they can see the team); only admins
// can change it.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await getSupabaseAdmin()
    .from("religious_monitors")
    .select(MEMBER_SELECT)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}

// POST: add a user as a religious monitor (admins/leadership only).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { user_id?: unknown };
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  if (!userId) return NextResponse.json({ error: "user_id is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase.from("whatsapp_users").select("id").eq("id", userId).maybeSingle();
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("religious_monitors")
    .insert({ user_id: userId })
    .select(MEMBER_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "User is already a religious monitor" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: data }, { status: 201 });
}
