import { NextRequest, NextResponse } from "next/server";

import {
  resolveCallerFromRequest,
  ForbiddenError,
} from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getElevatedDepartmentIds } from "@/lib/permissions";
import { isTaskPriority, isTaskStatus, priorityWeight, type TaskPriority } from "@/lib/tasks/types";

type CreateTaskBody = {
  title?: unknown;
  department_id?: unknown;
  department_name?: unknown;
  description?: unknown;
  assigned_to?: unknown;
  assigned_to_alias?: unknown;
  due_date?: unknown;
  source?: unknown;
  priority?: unknown;
};

const taskSelect =
  "id, title, description, status, priority, archived, assigned_to, created_by, source, due_date, department_id, created_at, updated_at, departments(name), assignee:whatsapp_users!tasks_assigned_to_fkey(display_name)";

type TaskRow = {
  priority?: string | null;
  updated_at?: string | null;
  department_id?: string | null;
  assigned_to?: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const supabase = getSupabaseAdmin();

    const status = req.nextUrl.searchParams.get("status");
    const departmentId = req.nextUrl.searchParams.get("department_id");
    const priority = req.nextUrl.searchParams.get("priority");
    const assigneeId = req.nextUrl.searchParams.get("assignee_id");
    const includeArchived = req.nextUrl.searchParams.get("include_archived") === "true";

    if (status && status !== "all" && !isTaskStatus(status)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }

    if (priority && priority !== "all" && !isTaskPriority(priority)) {
      return NextResponse.json({ error: "Invalid priority filter" }, { status: 400 });
    }

    let query = supabase
      .from("tasks")
      .select(taskSelect)
      .order("updated_at", { ascending: false });

    if (!includeArchived) {
      query = query.eq("archived", false);
    }

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (priority && priority !== "all") {
      query = query.eq("priority", priority);
    }

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }

    if (assigneeId) {
      query = query.eq("assigned_to", assigneeId);
    }

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

    let scopedTasks = (data ?? []) as TaskRow[];
    if (!caller.can_read_all) {
      const elevatedDeptIds = new Set(getElevatedDepartmentIds(caller));
      scopedTasks = scopedTasks.filter(
        (task) => task.assigned_to === caller.user_id || elevatedDeptIds.has(task.department_id ?? ""),
      );
    }

    return NextResponse.json(sortTasksByPriority(scopedTasks));
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
    const body = (await req.json()) as CreateTaskBody;

    const title = getOptionalString(body.title);
    const departmentName = getOptionalString(body.department_name);
    const departmentId = getOptionalString(body.department_id);
    const description = getOptionalString(body.description);
    const assignedToInput = getOptionalString(body.assigned_to);
    const assignedToAlias = getOptionalString(body.assigned_to_alias);
    const dueDate = getOptionalString(body.due_date);
    const source = getOptionalString(body.source) ?? "whatsapp_agent";
    const priority = getPriorityOrDefault(body.priority);

    if (!title || (!departmentId && !departmentName)) {
      return NextResponse.json({ error: "title and department_id or department_name are required" }, { status: 400 });
    }

    if (source !== "transcript" && source !== "whatsapp_agent" && source !== "manual") {
      return NextResponse.json({ error: "Invalid task source" }, { status: 400 });
    }

    const deptQuery = supabase.from("departments").select("id, name");
    const { data: dept, error: deptErr } = departmentId
      ? await deptQuery.eq("id", departmentId).single()
      : await deptQuery.eq("name", departmentName).single();

    if (deptErr || !dept) {
      return NextResponse.json({ error: `Department not found: ${departmentName ?? departmentId}` }, { status: 404 });
    }

    const callerDept = caller.departments.find((d) => d.department_id === dept.id);
    const canManageDepartment =
      caller.can_write_all || callerDept?.dept_role === "pm" || callerDept?.dept_role === "hod";

    if (!caller.can_write_all && !callerDept) {
      return NextResponse.json({ error: "Insufficient permissions to create tasks in this department" }, { status: 403 });
    }

    let assignedTo: string | null = null;
    if (!canManageDepartment) {
      if (assignedToInput || assignedToAlias) {
        return NextResponse.json({ error: "Members can only create tickets assigned to themselves" }, { status: 403 });
      }
      assignedTo = caller.user_id;
    } else if (assignedToInput) {
      assignedTo = assignedToInput;
    } else if (assignedToAlias) {
      const { data: assignee } = await supabase
        .from("whatsapp_users")
        .select("id")
        .contains("transcript_aliases", [assignedToAlias])
        .maybeSingle();
      assignedTo = assignee?.id ?? null;
    }

    if (assignedTo && !caller.can_write_all) {
      const { data: membership } = await supabase
        .from("department_members")
        .select("id")
        .eq("department_id", dept.id)
        .eq("user_id", assignedTo)
        .eq("is_active", true)
        .maybeSingle();

      if (!membership) {
        return NextResponse.json({ error: "Assignee must be an active member of this department" }, { status: 403 });
      }
    }

    const { data: task, error: insertErr } = await supabase
      .from("tasks")
      .insert({
        title,
        department_id: dept.id,
        description,
        assigned_to: assignedTo,
        created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
        source,
        due_date: dueDate,
        priority,
      })
      .select("id, title, status, priority, department_id, assigned_to, created_at")
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

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getPriorityOrDefault(value: unknown): TaskPriority {
  if (!value) return "medium";
  return isTaskPriority(value) ? value : "medium";
}

function sortTasksByPriority<T extends { priority?: string | null; updated_at?: string | null }>(tasks: T[]): T[] {
  return tasks.sort((a, b) => {
    const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
  });
}
