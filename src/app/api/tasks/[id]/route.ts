import { NextRequest, NextResponse } from "next/server";

import {
  resolveCallerFromRequest,
  guardDeptAccess,
  ForbiddenError,
} from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { data: task, error } = await supabase
      .from("tasks")
      .select("id, title, description, status, assigned_to, created_by, source, due_date, department_id, created_at, updated_at, departments(name), assignee:whatsapp_users!tasks_assigned_to_fkey(display_name)")
      .eq("id", id)
      .single();

    if (error || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    guardDeptAccess(caller, task.department_id);

    return NextResponse.json(task);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    // Get existing task
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, department_id")
      .eq("id", id)
      .single();

    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check write access to task's department
    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === task.department_id);
      if (!hasDept || hasDept.dept_role === "member") {
        return NextResponse.json({ error: "Insufficient permissions to update this task" }, { status: 403 });
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.status) updates.status = body.status;
    if (body.title) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.due_date !== undefined) updates.due_date = body.due_date;

    if (body.assigned_to_alias) {
      const { data: assignee } = await supabase
        .from("whatsapp_users")
        .select("id")
        .contains("transcript_aliases", [body.assigned_to_alias])
        .maybeSingle();
      if (assignee) {
        updates.assigned_to = assignee.id;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid update fields provided" }, { status: 400 });
    }

    const { data: updated, error: updateErr } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", id)
      .select("id, title, status, assigned_to, department_id, updated_at")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
