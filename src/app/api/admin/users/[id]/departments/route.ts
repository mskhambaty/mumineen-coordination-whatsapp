import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const deptRoles = new Set(["member", "pm", "hod"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("department_members")
    .select("id, department_id, dept_role, is_active, contact_for_issues, departments(name)")
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
    department_name: (m.departments as unknown as { name: string } | null)?.name ?? "",
  }));

  return NextResponse.json(memberships);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { department_id, dept_role } = body;

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
      .select("id, department_id, dept_role, is_active, contact_for_issues")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
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

  return NextResponse.json(data, { status: 201 });
}
