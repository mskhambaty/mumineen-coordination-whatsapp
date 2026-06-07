import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const MEMBER_SELECT =
  "id, created_at, department_id, department:departments(name), user:whatsapp_users(id, display_name, email, phone_e164), hours:escalation_oncall_hours(id, day_of_week, start_time, end_time)";

// GET: list escalation/support members with their user info and on-call hours.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
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

// POST: add an existing user to the support team (membership = role assignment).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { user_id?: unknown; department_id?: unknown };
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  // null department_id = general "all departments" fallback (notified for unclassified escalations).
  const departmentId = typeof body.department_id === "string" && body.department_id ? body.department_id : null;
  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Escalation alerts are delivered by email, so a support member must have one.
  const { data: user } = await supabase
    .from("whatsapp_users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.email || !user.email.trim()) {
    return NextResponse.json(
      { error: "This user has no email. Add an email to the user before adding them to the support team — escalations are delivered by email." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("escalation_support_members")
    .insert({ user_id: userId, department_id: departmentId })
    .select(MEMBER_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "User is already an escalation member for this department" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ member: data }, { status: 201 });
}
