import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getElevatedDepartmentIds } from "@/lib/permissions";
import { isTaskPriority, priorityWeight, type TaskStatus } from "@/lib/tasks/types";

type KanbanTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: string | null;
  archived: boolean | null;
  assigned_to: string | null;
  created_by: string | null;
  source: string;
  due_date: string | null;
  department_id: string;
  created_at: string;
  updated_at: string;
};

const taskSelect =
  "id, title, description, status, priority, archived, assigned_to, created_by, source, due_date, department_id, item_type, origin, source_phone, milestone_id, created_at, updated_at, departments(name), assignee:whatsapp_users!tasks_assigned_to_fkey(display_name)";

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const supabase = getSupabaseAdmin();
    const departmentId = req.nextUrl.searchParams.get("department_id");
    const priority = req.nextUrl.searchParams.get("priority");
    const assigneeId = req.nextUrl.searchParams.get("assignee_id");
    const includeComplete = req.nextUrl.searchParams.get("include_complete") === "true";

    if (priority && priority !== "all" && !isTaskPriority(priority)) {
      return NextResponse.json({ error: "Invalid priority filter" }, { status: 400 });
    }

    let query = supabase
      .from("tasks")
      .select(taskSelect)
      .eq("archived", false)
      .order("updated_at", { ascending: false });

    if (!includeComplete) {
      query = query.neq("status", "complete");
    }

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }

    const milestoneId = req.nextUrl.searchParams.get("milestone_id");
    if (milestoneId) {
      query = query.eq("milestone_id", milestoneId);
    }

    if (priority && priority !== "all") {
      query = query.eq("priority", priority);
    }

    if (assigneeId) {
      query = query.eq("assigned_to", assigneeId);
    }

    const itemType = req.nextUrl.searchParams.get("item_type");
    if (itemType && itemType !== "all") {
      query = query.eq("item_type", itemType);
    }

    const origin = req.nextUrl.searchParams.get("origin");
    if (origin && origin !== "all") {
      query = query.eq("origin", origin);
    }

    if (!caller.can_read_all) {
      const deptIds = caller.departments.map((department) => department.department_id);
      if (deptIds.length === 0) {
        return NextResponse.json(emptyBoard());
      }
      query = query.in("department_id", deptIds);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let scopedTasks = (data ?? []) as KanbanTask[];
    if (!caller.can_read_all) {
      const elevatedDeptIds = new Set(getElevatedDepartmentIds(caller));
      scopedTasks = scopedTasks.filter(
        (task) => task.assigned_to === caller.user_id || elevatedDeptIds.has(task.department_id),
      );
    }

    const board = emptyBoard();
    for (const task of scopedTasks) {
      if (task.status in board) {
        board[task.status].push(task);
      }
    }

    for (const status of Object.keys(board) as TaskStatus[]) {
      board[status].sort((a, b) => {
        const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
      });
    }

    return NextResponse.json(board);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

function emptyBoard(): Record<TaskStatus, KanbanTask[]> {
  return {
    open: [],
    in_progress: [],
    blocked: [],
    complete: [],
  };
}
