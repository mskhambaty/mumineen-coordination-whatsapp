import { NextRequest, NextResponse } from "next/server";

import { sendAdminWelcomeNotification } from "@/lib/admin/onboarding";
import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Re-sends the welcome notification (email + WhatsApp) with a fresh
// password-reset link for an existing user, without touching department
// memberships. Useful when a user was created (or auto-created as a visitor)
// outside the Add User flow and never received their onboarding link.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  let departmentId: string | undefined =
    typeof body.department_id === "string" ? body.department_id : undefined;

  const supabase = getSupabaseAdmin();

  const { data: user, error: userError } = await supabase
    .from("whatsapp_users")
    .select("id, email")
    .eq("id", id)
    .maybeSingle();

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // The welcome message names a department, so resolve one when not provided.
  // Prefer an active membership, otherwise fall back to any membership.
  if (!departmentId) {
    const { data: memberships, error: membershipError } = await supabase
      .from("department_members")
      .select("department_id, is_active")
      .eq("user_id", id)
      .order("is_active", { ascending: false });

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }

    departmentId = memberships?.[0]?.department_id ?? undefined;
  }

  if (!departmentId) {
    return NextResponse.json(
      { error: "Assign this user to a department before sending the welcome." },
      { status: 400 },
    );
  }

  // Manual admin action: always (re-)send, even if the user was already
  // welcomed — an admin clicks this precisely when a member asks for it again.
  const welcome = await sendAdminWelcomeNotification({ userId: id, departmentId, force: true });
  return NextResponse.json({ welcome_notification: welcome });
}
