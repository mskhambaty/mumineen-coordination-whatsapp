import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const deptRoles = new Set(["member", "pm", "hod"]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; membershipId: string }> },
) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const { membershipId } = await params;
  const body = await req.json();
  const supabase = getSupabaseAdmin();

  const updates: Record<string, unknown> = {};
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.contact_for_issues !== undefined) updates.contact_for_issues = Boolean(body.contact_for_issues);
  if (body.daily_feedback_digest !== undefined) updates.daily_feedback_digest = Boolean(body.daily_feedback_digest);
  if (body.dept_role) {
    if (!deptRoles.has(body.dept_role)) {
      return NextResponse.json({ error: "Invalid dept_role" }, { status: 400 });
    }
    updates.dept_role = body.dept_role;
  }

  const { data, error } = await supabase
    .from("department_members")
    .update(updates)
    .eq("id", membershipId)
    .select("id, department_id, dept_role, is_active, contact_for_issues, daily_feedback_digest")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
