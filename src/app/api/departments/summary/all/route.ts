import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { priorityWeight } from "@/lib/tasks/types";

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

    const [tasksResult, milestonesResult] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, department_id, title, status, priority, due_date, updated_at, item_type")
        .eq("archived", false),
      supabase
        .from("milestones")
        .select("id, department_id, title, status, budget, percent_complete"),
    ]);

    if (tasksResult.error) {
      return NextResponse.json({ error: tasksResult.error.message }, { status: 500 });
    }

    const allTasks = tasksResult.data;
    const allMilestones = milestonesResult.data ?? [];

    const today = new Date().toISOString().split("T")[0];

    const summary = (departments ?? []).map((dept) => {
      const deptTasks = (allTasks ?? []).filter((t) => t.department_id === dept.id);
      const deptMilestones = allMilestones.filter((m) => m.department_id === dept.id);
      const openIssues = deptTasks.filter((t) => t.item_type === "issue" && t.status !== "complete").length;
      const totalBudget = deptMilestones.reduce((sum, m) => sum + (Number(m.budget) || 0), 0);
      const avgCompletion = deptMilestones.length > 0
        ? Math.round(deptMilestones.reduce((sum, m) => sum + m.percent_complete, 0) / deptMilestones.length)
        : 0;

      const counts = {
        department_name: dept.name,
        department_id: dept.id,
        open: 0,
        in_progress: 0,
        blocked: 0,
        complete: 0,
        total: deptTasks.length,
        overdue: 0,
        milestone_count: deptMilestones.length,
        total_budget: totalBudget,
        avg_completion: avgCompletion,
        open_issues: openIssues,
        top_blockers: deptTasks
          .filter((task) => task.status === "blocked" || (task.due_date && task.due_date < today && task.status !== "complete"))
          .sort((a, b) => {
            const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
          })
          .slice(0, 3)
          .map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            due_date: task.due_date,
          })),
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
