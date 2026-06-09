import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const MEMBER_SELECT = "id, created_at, user:whatsapp_users(id, display_name, email, phone_e164)";

// GET: list escalation/support team members.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await getSupabaseAdmin()
    .from("escalation_support_members")
    .select(MEMBER_SELECT)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ members: data ?? [] });
}

// POST: add a user to the escalation team. At least one of email or phone must
// be present so notifications can reach them.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { user_id?: unknown };
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: user } = await supabase
    .from("whatsapp_users")
    .select("email, phone_e164")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.email?.trim() && !user.phone_e164?.trim()) {
    return NextResponse.json(
      { error: "This user has no email or phone — add one before adding them to the escalation team." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("escalation_support_members")
    .insert({ user_id: userId })
    .select(MEMBER_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "User is already on the escalation team" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ member: data }, { status: 201 });
}
