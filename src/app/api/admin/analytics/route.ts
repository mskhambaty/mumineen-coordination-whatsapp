import { NextRequest, NextResponse } from "next/server";

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

type SessionRow = {
  id: string;
  phone_e164: string;
  handling_mode: "ai" | "manual" | null;
  last_message_at: string | null;
  created_at: string | null;
  escalation_status?: string | null;
  quality_score?: "good" | "poor" | null;
  quality_analyzed_at?: string | null;
};

type MilestoneRow = {
  id: string;
  status: string;
  department_id: string;
};

type MessageRow = {
  id: string;
  phone_e164: string;
  direction: "inbound" | "outbound";
  created_at: string;
};

type ToolAuditRow = {
  id: string;
  phone_e164: string | null;
  tool_name: string;
  allowed: boolean;
  created_at: string;
};

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_read_all) {
      return NextResponse.json({ error: "Leadership/Admin access required" }, { status: 403 });
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

    const [{ data: sessions }, { data: messages }, { data: toolCalls }, { data: milestoneRows }] = await Promise.all([
      supabase
        .from("conversation_sessions")
        .select("id, phone_e164, handling_mode, last_message_at, created_at, escalation_status, quality_score, quality_analyzed_at")
        .gte("last_message_at", thirtyDaysAgo.toISOString()),
      supabase
        .from("messages")
        .select("id, phone_e164, direction, created_at")
        .gte("created_at", thirtyDaysAgo.toISOString()),
      supabase
        .from("tool_audit_logs")
        .select("id, phone_e164, tool_name, allowed, created_at")
        .gte("created_at", thirtyDaysAgo.toISOString()),
      supabase
        .from("milestones")
        .select("id, status, department_id"),
    ]);

    const typedSessions = (sessions ?? []) as SessionRow[];

    // Resolve which phones belong to committee/admin users for external vs internal split
    const { data: knownUsers } = await supabase
      .from("whatsapp_users")
      .select("phone_e164, role")
      .in("role", ["committee", "admin"]);
    const memberPhones = new Set((knownUsers ?? []).map((u: { phone_e164: string }) => u.phone_e164));

    return NextResponse.json({
      departments: departments ?? [],
      tasks: buildTaskAnalytics(scopedTasks, departmentMap, today),
      conversations: buildConversationAnalytics(
        typedSessions,
        (messages ?? []) as MessageRow[],
        (toolCalls ?? []) as ToolAuditRow[],
        thirtyDaysAgo,
        memberPhones,
      ),
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

function buildConversationAnalytics(
  sessions: SessionRow[],
  messages: MessageRow[],
  toolCalls: ToolAuditRow[],
  since: Date,
  memberPhones: Set<string>,
) {
  const inbound = messages.filter((message) => message.direction === "inbound").length;
  const outbound = messages.filter((message) => message.direction === "outbound").length;
  const byDay = buildDailyMessageCounts(messages, since);
  const topTools = new Map<string, number>();

  for (const call of toolCalls) {
    topTools.set(call.tool_name, (topTools.get(call.tool_name) ?? 0) + 1);
  }

  const escalationCount = sessions.filter((s) => s.escalation_status === "pending").length;

  let qualityGood = 0;
  let qualityPoor = 0;
  let qualityUnscored = 0;
  const qualityByDay = new Map<string, { date: string; good: number; poor: number }>();
  for (const session of sessions) {
    if (session.quality_score === "good") qualityGood++;
    else if (session.quality_score === "poor") qualityPoor++;
    else qualityUnscored++;

    if (session.quality_analyzed_at && session.quality_score) {
      const day = new Date(session.quality_analyzed_at).toISOString().split("T")[0];
      const bucket = qualityByDay.get(day) ?? { date: day, good: 0, poor: 0 };
      if (session.quality_score === "good") bucket.good++;
      else bucket.poor++;
      qualityByDay.set(day, bucket);
    }
  }

  let externalMessages = 0;
  let internalMessages = 0;
  for (const msg of messages) {
    if (msg.direction === "inbound") {
      if (memberPhones.has(msg.phone_e164)) internalMessages++;
      else externalMessages++;
    }
  }

  return {
    window_days: 30,
    active_conversations: sessions.length,
    manual_conversations: sessions.filter((session) => session.handling_mode === "manual").length,
    ai_conversations: sessions.filter((session) => session.handling_mode !== "manual").length,
    inbound_messages: inbound,
    outbound_messages: outbound,
    total_messages: messages.length,
    tool_calls: toolCalls.length,
    blocked_tool_calls: toolCalls.filter((call) => !call.allowed).length,
    messages_by_day: byDay,
    top_tools: Array.from(topTools.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    escalation_count: escalationCount,
    quality_summary: { good: qualityGood, poor: qualityPoor, unscored: qualityUnscored },
    quality_by_day: Array.from(qualityByDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    external_user_messages: externalMessages,
    internal_user_messages: internalMessages,
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

function buildDailyMessageCounts(messages: MessageRow[], since: Date) {
  const counts = new Map<string, { date: string; inbound: number; outbound: number }>();
  for (let offset = 0; offset <= 30; offset++) {
    const date = new Date(since);
    date.setDate(since.getDate() + offset);
    const key = date.toISOString().split("T")[0];
    counts.set(key, { date: key, inbound: 0, outbound: 0 });
  }

  for (const message of messages) {
    const key = new Date(message.created_at).toISOString().split("T")[0];
    const bucket = counts.get(key);
    if (!bucket) continue;
    if (message.direction === "inbound") bucket.inbound++;
    if (message.direction === "outbound") bucket.outbound++;
  }

  return Array.from(counts.values());
}
