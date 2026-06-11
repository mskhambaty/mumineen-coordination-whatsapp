import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { priorityWeight } from "@/lib/tasks/types";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  department_id: string;
  assigned_to: string | null;
  updated_at: string | null;
  item_type: string | null;
};

type DepartmentRow = {
  id: string;
  name: string;
};

type MilestoneRow = {
  id: string;
  status: string;
  department_id: string;
};

type ConversationStats = {
  session_counts: {
    total: number;
    ai: number;
    manual: number;
    escalation_pending: number;
    quality_good: number;
    quality_poor: number;
    quality_unscored: number;
  };
  quality_by_day: Array<{ date: string; good: number; poor: number }>;
  message_counts: { total: number; inbound: number; outbound: number };
  messages_by_day: Array<{ date: string; inbound: number; outbound: number }>;
  user_message_split: { external: number; internal: number };
  tool_counts: { total: number; blocked: number };
  top_tools: Array<{ name: string; count: number }>;
};

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    // Home dashboard analytics are open to every portal user (committee/admin) —
    // aggregate KPIs only, no per-message PII. Visitors never get a portal session.
    if (!canAccessPortal(caller.portal)) {
      return NextResponse.json({ error: "Portal access required" }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();
    const departmentId = req.nextUrl.searchParams.get("department_id");
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const today = now.toISOString().split("T")[0];

    const [{ data: departments, error: deptError }, { data: tasks, error: tasksError }] =
      await Promise.all([
        supabase.from("departments").select("id, name").order("name"),
        buildTaskQuery(supabase, departmentId),
      ]);

    if (deptError) {
      return NextResponse.json({ error: deptError.message }, { status: 500 });
    }
    if (tasksError) {
      return NextResponse.json({ error: tasksError.message }, { status: 500 });
    }

    const departmentMap = new Map(
      ((departments ?? []) as DepartmentRow[]).map((department) => [department.id, department.name]),
    );
    const scopedTasks = (tasks ?? []) as TaskRow[];

    // Conversation/message/tool stats are aggregated server-side via a SQL function
    // to avoid the PostgREST max_rows cap (1000).
    const [{ data: convStats, error: convError }, { data: milestoneRows }] = await Promise.all([
      supabase.rpc("dashboard_conversation_stats", { p_since: thirtyDaysAgo.toISOString() }),
      supabase.from("milestones").select("id, status, department_id"),
    ]);

    if (convError) {
      return NextResponse.json({ error: convError.message }, { status: 500 });
    }

    const stats = convStats as ConversationStats;

    // Fill in days with zero messages so the chart always has 31 bars
    const dayMap = new Map<string, { date: string; inbound: number; outbound: number }>();
    for (let offset = 0; offset <= 30; offset++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(thirtyDaysAgo.getDate() + offset);
      const key = d.toISOString().split("T")[0];
      dayMap.set(key, { date: key, inbound: 0, outbound: 0 });
    }
    for (const row of stats.messages_by_day) {
      const bucket = dayMap.get(row.date);
      if (bucket) {
        bucket.inbound = row.inbound;
        bucket.outbound = row.outbound;
      }
    }

    return NextResponse.json({
      departments: departments ?? [],
      tasks: buildTaskAnalytics(scopedTasks, departmentMap, today),
      conversations: {
        window_days: 30,
        active_conversations: stats.session_counts.total,
        manual_conversations: stats.session_counts.manual,
        ai_conversations: stats.session_counts.ai,
        inbound_messages: stats.message_counts.inbound,
        outbound_messages: stats.message_counts.outbound,
        total_messages: stats.message_counts.total,
        tool_calls: stats.tool_counts.total,
        blocked_tool_calls: stats.tool_counts.blocked,
        messages_by_day: Array.from(dayMap.values()),
        top_tools: stats.top_tools,
        escalation_count: stats.session_counts.escalation_pending,
        quality_summary: {
          good: stats.session_counts.quality_good,
          poor: stats.session_counts.quality_poor,
          unscored: stats.session_counts.quality_unscored,
        },
        quality_by_day: stats.quality_by_day,
        external_user_messages: stats.user_message_split.external,
        internal_user_messages: stats.user_message_split.internal,
      },
      milestones: buildMilestoneAnalytics((milestoneRows ?? []) as MilestoneRow[], departmentMap),
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

function buildTaskQuery(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  departmentId: string | null,
) {
  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, due_date, department_id, assigned_to, updated_at, item_type")
    .eq("archived", false);

  if (departmentId && departmentId !== "all") {
    query = query.eq("department_id", departmentId);
  }

  return query;
}

function buildTaskAnalytics(tasks: TaskRow[], departmentMap: Map<string, string>, today: string) {
  const byStatus = { open: 0, in_progress: 0, blocked: 0, complete: 0 };
  const byPriority = { high: 0, medium: 0, low: 0 };
  const departmentCounts = new Map<string, { department_id: string; department_name: string; total: number; overdue: number; blocked: number }>();

  for (const task of tasks) {
    if (task.status in byStatus) {
      byStatus[task.status as keyof typeof byStatus]++;
    }
    if (task.priority in byPriority) {
      byPriority[task.priority as keyof typeof byPriority]++;
    }

    const existing = departmentCounts.get(task.department_id) ?? {
      department_id: task.department_id,
      department_name: departmentMap.get(task.department_id) ?? "Unknown",
      total: 0,
      overdue: 0,
      blocked: 0,
    };
    existing.total++;
    if (task.status === "blocked") existing.blocked++;
    if (isOverdue(task, today)) existing.overdue++;
    departmentCounts.set(task.department_id, existing);
  }

  const overdue = tasks
    .filter((task) => isOverdue(task, today))
    .sort((a, b) => {
      const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return String(a.due_date).localeCompare(String(b.due_date));
    })
    .slice(0, 20)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      due_date: task.due_date,
      department_id: task.department_id,
      department_name: departmentMap.get(task.department_id) ?? "Unknown",
    }));

  const issues = tasks.filter((task) => task.item_type === "issue");
  const issuesByStatus = { open: 0, in_progress: 0, blocked: 0, complete: 0 };
  const issuesByDept = new Map<string, { department_name: string; count: number }>();
  for (const issue of issues) {
    if (issue.status in issuesByStatus) {
      issuesByStatus[issue.status as keyof typeof issuesByStatus]++;
    }
    if (issue.department_id) {
      const existing = issuesByDept.get(issue.department_id) ?? {
        department_name: departmentMap.get(issue.department_id) ?? "Unknown",
        count: 0,
      };
      existing.count++;
      issuesByDept.set(issue.department_id, existing);
    }
  }

  return {
    total: tasks.length,
    active: tasks.filter((task) => task.status !== "complete").length,
    overdue: overdue.length,
    blocked: byStatus.blocked,
    by_status: byStatus,
    by_priority: byPriority,
    by_department: Array.from(departmentCounts.values()).sort((a, b) => b.total - a.total),
    overdue_list: overdue,
    issues: {
      total: issues.length,
      open: issuesByStatus.open + issuesByStatus.in_progress,
      blocked: issuesByStatus.blocked,
      resolved: issuesByStatus.complete,
      by_status: issuesByStatus,
      by_department: Array.from(issuesByDept.values()).sort((a, b) => b.count - a.count),
    },
  };
}

function buildMilestoneAnalytics(milestones: MilestoneRow[], departmentMap: Map<string, string>) {
  const byStatus: Record<string, number> = { open: 0, in_progress: 0, blocked: 0, complete: 0 };
  const byDepartment = new Map<string, { department_name: string; total: number; complete: number }>();

  for (const ms of milestones) {
    if (ms.status in byStatus) byStatus[ms.status]++;
    const existing = byDepartment.get(ms.department_id) ?? {
      department_name: departmentMap.get(ms.department_id) ?? "Unknown",
      total: 0,
      complete: 0,
    };
    existing.total++;
    if (ms.status === "complete") existing.complete++;
    byDepartment.set(ms.department_id, existing);
  }

  return {
    total: milestones.length,
    by_status: byStatus,
    by_department: Array.from(byDepartment.values()).sort((a, b) => b.total - a.total),
  };
}

function isOverdue(task: TaskRow, today: string) {
  return Boolean(task.due_date && task.due_date < today && task.status !== "complete");
}

