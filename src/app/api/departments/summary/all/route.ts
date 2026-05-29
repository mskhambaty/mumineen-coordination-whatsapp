import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);

    if (!caller.can_read_all) {
      return NextResponse.json({ error: "Leadership/Admin access required" }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();
    const filter = req.nextUrl.searchParams.get("filter") ?? "all";

    // Get all departments
    const { data: departments, error: deptErr } = await supabase
      .from("departments")
      .select("id, name")
      .order("name");

    if (deptErr) {
      return NextResponse.json({ error: deptErr.message }, { status: 500 });
    }

    // Get all tasks
    const { data: allTasks, error: tasksErr } = await supabase
      .from("tasks")
      .select("id, department_id, status, due_date");

    if (tasksErr) {
      return NextResponse.json({ error: tasksErr.message }, { status: 500 });
    }

    const today = new Date().toISOString().split("T")[0];

    const summary = (departments ?? []).map((dept) => {
      const deptTasks = (allTasks ?? []).filter((t) => t.department_id === dept.id);
      const counts = {
        department_name: dept.name,
        department_id: dept.id,
        open: 0,
        in_progress: 0,
        blocked: 0,
        complete: 0,
        total: deptTasks.length,
        overdue: 0,
      };

      for (const task of deptTasks) {
        const s = task.status as "open" | "in_progress" | "blocked" | "complete";
        if (s in counts) {
          (counts[s] as number)++;
        }
        if (task.due_date && task.due_date < today && task.status !== "complete") {
          counts.overdue++;
        }
      }

      return counts;
    });

    // Apply filter
    let filtered = summary;
    if (filter === "blocked") {
      filtered = summary.filter((s) => s.blocked > 0);
    } else if (filter === "overdue") {
      filtered = summary.filter((s) => s.overdue > 0);
    } else if (filter === "on_track") {
      filtered = summary.filter((s) => s.blocked === 0 && s.overdue === 0);
    }

    return NextResponse.json(filtered);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
