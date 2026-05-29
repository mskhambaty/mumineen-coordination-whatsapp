import { NextRequest, NextResponse } from "next/server";

import {
  resolveCallerFromRequest,
  ForbiddenError,
} from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const supabase = getSupabaseAdmin();

    const status = req.nextUrl.searchParams.get("status");
    const departmentId = req.nextUrl.searchParams.get("department_id");

    let query = supabase
      .from("tasks")
      .select("id, title, description, status, assigned_to, created_by, source, due_date, department_id, created_at, updated_at, departments(name), assignee:whatsapp_users!tasks_assigned_to_fkey(display_name)")
      .order("updated_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }

    // Scope to caller's departments if not leadership_admin
    if (!caller.can_read_all) {
      const deptIds = caller.departments.map((d) => d.department_id);
      if (deptIds.length === 0) {
        return NextResponse.json([]);
      }
      query = query.in("department_id", deptIds);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    const { title, department_name, description, assigned_to_alias, due_date, source } = body;

    if (!title || !department_name) {
      return NextResponse.json({ error: "title and department_name are required" }, { status: 400 });
    }

    // Resolve department
    const { data: dept, error: deptErr } = await supabase
      .from("departments")
      .select("id")
      .eq("name", department_name)
      .single();

    if (deptErr || !dept) {
      return NextResponse.json({ error: `Department not found: ${department_name}` }, { status: 404 });
    }

    // Check write access
    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === dept.id);
      if (!hasDept || hasDept.dept_role === "member") {
        return NextResponse.json({ error: "Insufficient permissions to create tasks in this department" }, { status: 403 });
      }
    }

    // Resolve assigned_to_alias
    let assignedTo: string | null = null;
    if (assigned_to_alias) {
      const { data: assignee } = await supabase
        .from("whatsapp_users")
        .select("id")
        .contains("transcript_aliases", [assigned_to_alias])
        .maybeSingle();
      assignedTo = assignee?.id ?? null;
    }

    const { data: task, error: insertErr } = await supabase
      .from("tasks")
      .insert({
        title,
        department_id: dept.id,
        description: description ?? null,
        assigned_to: assignedTo,
        created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
        source: source ?? "whatsapp_agent",
        due_date: due_date ?? null,
      })
      .select("id, title, status, department_id, assigned_to, created_at")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
