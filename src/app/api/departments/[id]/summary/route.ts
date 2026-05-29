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
    guardDeptAccess(caller, id);

    const supabase = getSupabaseAdmin();

    // Get task counts by status
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id, status, title, updated_at")
      .eq("department_id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const counts = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      complete: 0,
      total: tasks?.length ?? 0,
    };

    for (const task of tasks ?? []) {
      const s = task.status as keyof typeof counts;
      if (s in counts) {
        counts[s]++;
      }
    }

    // Get 5 most recently updated tasks
    const recentTasks = (tasks ?? [])
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 5)
      .map((t) => ({ id: t.id, title: t.title, status: t.status, updated_at: t.updated_at }));

    return NextResponse.json({ ...counts, recent_tasks: recentTasks });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
