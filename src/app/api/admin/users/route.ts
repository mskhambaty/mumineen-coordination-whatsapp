import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal, isAdminOrLeadership } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const userRoles = new Set(["visitor", "committee", "admin"]);
const globalRoles = new Set(["member", "pm", "hod", "leadership_admin"]);

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();
  const departmentId = req.nextUrl.searchParams.get("department_id");

  let membershipByUserId = new Map<string, { id: string; dept_role: string; contact_for_issues: boolean; daily_feedback_digest: boolean }>();
  let userIds: string[] | null = null;
  if (departmentId && departmentId !== "all") {
    const { data: memberships, error: membershipError } = await supabase
      .from("department_members")
      .select("id, user_id, dept_role, contact_for_issues, daily_feedback_digest")
      .eq("department_id", departmentId)
      .eq("is_active", true);

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }

    membershipByUserId = new Map(
      (memberships ?? []).map((membership) => [
        membership.user_id as string,
        {
          id: membership.id as string,
          dept_role: membership.dept_role as string,
          contact_for_issues: Boolean(membership.contact_for_issues),
          daily_feedback_digest: membership.daily_feedback_digest !== false,
        },
      ]),
    );
    userIds = Array.from(membershipByUserId.keys());
    if (userIds.length === 0) {
      return NextResponse.json([]);
    }
  }

  let query = supabase
    .from("whatsapp_users")
    .select("id, display_name, phone_e164, email, role, global_role, status, last_login_at")
    .neq("role", "visitor")
    .order("display_name");

  if (userIds) {
    query = query.in("id", userIds);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []).map((user) => {
    const membership = membershipByUserId.get(user.id as string);
    return {
      ...user,
      department_membership_id: membership?.id ?? null,
      department_role: membership?.dept_role ?? null,
      contact_for_issues: membership?.contact_for_issues ?? false,
      daily_feedback_digest: membership?.daily_feedback_digest ?? true,
    };
  }));
}

export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const callerIsAdmin = isAdminOrLeadership(auth.caller.portal);

  const body = await req.json();
  const { display_name, phone_e164, email } = body;
  const role = typeof body.role === "string" && userRoles.has(body.role) ? body.role : "committee";
  const globalRole =
    typeof body.global_role === "string" && globalRoles.has(body.global_role)
      ? body.global_role
      : role === "admin"
        ? "leadership_admin"
        : "member";

  // Only admins/leadership may create a user that holds Admin/Leadership access.
  if (!callerIsAdmin && (role === "admin" || globalRole === "leadership_admin")) {
    return NextResponse.json(
      { error: "Only admin/leadership can grant admin/leadership access" },
      { status: 403 },
    );
  }

  if (!display_name || !phone_e164) {
    return NextResponse.json({ error: "display_name and phone_e164 are required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const sel = "id, display_name, phone_e164, email, role, global_role, status";

  // A person who already messaged the bot exists as a (usually visitor) row keyed by their unique
  // phone. "Add User" must PROMOTE that existing row — set the name/email/role + activate it —
  // instead of failing on the unique-phone constraint. So: find-or-update on phone_e164.
  const { data: existing } = await supabase
    .from("whatsapp_users")
    .select("id")
    .eq("phone_e164", phone_e164)
    .maybeSingle();

  const fields = { display_name, email: email || null, global_role: globalRole, role, status: "active" as const };

  const { data, error } = existing?.id
    ? await supabase.from("whatsapp_users").update(fields).eq("id", existing.id).select(sel).single()
    : await supabase
        .from("whatsapp_users")
        .insert({ ...fields, phone_e164, transcript_aliases: [display_name] })
        .select(sel)
        .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: existing?.id ? 200 : 201 });
}
