import { NextRequest, NextResponse } from "next/server";

import { sendAdminWelcomeNotification, type WelcomeNotificationResult } from "@/lib/admin/onboarding";
import { canAccessPortal } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const deptRoles = new Set(["member", "pm", "hod"]);

function failedWelcomeNotification(error: unknown): WelcomeNotificationResult {
  const message = error instanceof Error ? error.message : "Welcome notification failed.";
  return {
    email: "failed",
    whatsapp: "failed",
    already_welcomed: false,
    errors: [message],
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("department_members")
    .select("id, department_id, dept_role, is_active, contact_for_issues, daily_feedback_digest, departments(name)")
    .eq("user_id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const memberships = (data ?? []).map((m) => ({
    id: m.id,
    department_id: m.department_id,
    dept_role: m.dept_role,
    is_active: m.is_active,
    contact_for_issues: Boolean(m.contact_for_issues),
    daily_feedback_digest: m.daily_feedback_digest !== false,
    department_name: (m.departments as unknown as { name: string } | null)?.name ?? "",
  }));

  return NextResponse.json(memberships);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await req.json();
  const { department_id, dept_role } = body;
  const sendWelcome = body.send_welcome === true;

  if (!department_id || !dept_role) {
    return NextResponse.json({ error: "department_id and dept_role are required" }, { status: 400 });
  }
  if (!deptRoles.has(dept_role)) {
    return NextResponse.json({ error: "Invalid dept_role" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("department_members")
    .select("id")
    .eq("user_id", id)
    .eq("department_id", department_id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (existing) {
    const { data, error } = await supabase
      .from("department_members")
      .update({ dept_role, is_active: true })
      .eq("id", existing.id)
      .select("id, department_id, dept_role, is_active, contact_for_issues, daily_feedback_digest")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!sendWelcome) {
      return NextResponse.json(data);
    }

    const welcomeNotification = await sendAdminWelcomeNotification({ userId: id, departmentId: department_id })
      .catch(failedWelcomeNotification);

    return NextResponse.json({ ...data, welcome_notification: welcomeNotification });
  }

  const { data, error } = await supabase
    .from("department_members")
    .insert({
      user_id: id,
      department_id,
      dept_role,
      is_active: true,
    })
    .select("id, department_id, dept_role, is_active, contact_for_issues")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "User already in this department" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!sendWelcome) {
    return NextResponse.json(data, { status: 201 });
  }

  const welcomeNotification = await sendAdminWelcomeNotification({ userId: id, departmentId: department_id })
    .catch(failedWelcomeNotification);

  return NextResponse.json({ ...data, welcome_notification: welcomeNotification }, { status: 201 });
}
