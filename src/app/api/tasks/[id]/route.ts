import { NextRequest, NextResponse } from "next/server";

import {
  resolveCallerFromRequest,
  guardDeptAccess,
  ForbiddenError,
} from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTaskPriority, isTaskStatus } from "@/lib/tasks/types";

type UpdateTaskBody = {
  status?: unknown;
  priority?: unknown;
  title?: unknown;
  description?: unknown;
  due_date?: unknown;
  assigned_to?: unknown;
  assigned_to_alias?: unknown;
  archived?: unknown;
  note?: unknown;
};

const taskSelect =
  "id, title, description, status, priority, archived, assigned_to, created_by, source, due_date, department_id, created_at, updated_at, departments(name), assignee:whatsapp_users!tasks_assigned_to_fkey(display_name)";

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
      .select(taskSelect)
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
    const body = (await req.json()) as UpdateTaskBody;

    // Get existing task
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, department_id, assigned_to")
      .eq("id", id)
      .single();

    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canUpdateOwnTask = caller.global_role === "member" && task.assigned_to === caller.user_id;

    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === task.department_id);
      if ((!hasDept || hasDept.dept_role === "member") && !canUpdateOwnTask) {
        return NextResponse.json({ error: "Insufficient permissions to update this task" }, { status: 403 });
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (!isTaskStatus(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updates.status = body.status;
    }
    if (body.priority !== undefined) {
      if (!isTaskPriority(body.priority)) {
        return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
      }
      updates.priority = body.priority;
    }
    if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();
    if (body.description !== undefined) updates.description = body.description;
    if (body.due_date !== undefined) updates.due_date = body.due_date;
    if (typeof body.archived === "boolean") {
      if (canUpdateOwnTask && !caller.can_write_all) {
        return NextResponse.json({ error: "Insufficient permissions to archive this task" }, { status: 403 });
      }
      updates.archived = body.archived;
    }

    const assignedTo = typeof body.assigned_to === "string" ? body.assigned_to : undefined;
    if (assignedTo) {
      if (canUpdateOwnTask && !caller.can_write_all) {
        return NextResponse.json({ error: "Members can only assign tasks to themselves" }, { status: 403 });
      }
      await guardAssigneeAccess(supabase, task.department_id, assignedTo, caller.can_write_all);
      updates.assigned_to = assignedTo;
    } else if (typeof body.assigned_to_alias === "string" && body.assigned_to_alias.trim()) {
      if (canUpdateOwnTask && !caller.can_write_all) {
        return NextResponse.json({ error: "Members can only assign tasks to themselves" }, { status: 403 });
      }
      const { data: assignee } = await supabase
        .from("whatsapp_users")
        .select("id")
        .contains("transcript_aliases", [body.assigned_to_alias.trim()])
        .maybeSingle();
      if (assignee) {
        await guardAssigneeAccess(supabase, task.department_id, assignee.id as string, caller.can_write_all);
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
      .select("id, title, status, priority, archived, assigned_to, department_id, updated_at")
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

async function guardAssigneeAccess(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  departmentId: string,
  userId: string,
  canAssignAll: boolean,
) {
  if (canAssignAll) return;

  const { data: membership } = await supabase
    .from("department_members")
    .select("id")
    .eq("department_id", departmentId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership) {
    throw new ForbiddenError("Assignee must be an active member of this department");
  }
}
