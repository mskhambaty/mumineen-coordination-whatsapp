import { NextRequest, NextResponse } from "next/server";

import {
  resolveCallerFromRequest,
  guardDeptAccess,
  ForbiddenError,
} from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTaskPriority, isTaskStatus, priorityWeight } from "@/lib/tasks/types";

const taskSelect =
  "id, title, description, status, priority, archived, assigned_to, created_by, source, due_date, department_id, created_at, updated_at, assignee:whatsapp_users!tasks_assigned_to_fkey(display_name)";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;
    if (caller.global_role !== "member") {
      guardDeptAccess(caller, id);
    }

    const supabase = getSupabaseAdmin();
    const status = req.nextUrl.searchParams.get("status");
    const priority = req.nextUrl.searchParams.get("priority");

    if (status && status !== "all" && !isTaskStatus(status)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }

    if (priority && priority !== "all" && !isTaskPriority(priority)) {
      return NextResponse.json({ error: "Invalid priority filter" }, { status: 400 });
    }

    let query = supabase
      .from("tasks")
      .select(taskSelect)
      .eq("department_id", id)
      .eq("archived", false)
      .order("updated_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (priority && priority !== "all") {
      query = query.eq("priority", priority);
    }

    if (caller.global_role === "member" && !caller.can_read_all) {
      query = query.eq("assigned_to", caller.user_id);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json((data ?? []).sort((a, b) => {
      const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
    }));
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
