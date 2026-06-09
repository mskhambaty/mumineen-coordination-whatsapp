import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionRow = {
  id: string;
  phone_e164: string;
  user_id: string | null;
  escalation_stage: string;
  escalation_status: string | null;
  escalation_priority: string | null;
  escalation_category: string | null;
  escalation_reason: string | null;
  escalated_at: string | null;
  escalation_sla_deadline: string | null;
  escalation_assigned_to: string | null;
  linked_task_id: string | null;
  last_message_at: string | null;
};

type UserRow = {
  id: string;
  display_name: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  department_id: string | null;
};

type DeptRow = {
  id: string;
  name: string;
};

type MessageRow = {
  phone_e164: string;
  body: string | null;
  created_at: string;
};

type ActivityRow = {
  conversation_session_id: string | null;
  created_at: string;
};

type SupportMemberRow = {
  user_id: string;
  whatsapp_users: { display_name: string | null } | { display_name: string | null }[] | null;
};

// ---------------------------------------------------------------------------
// GET /api/admin/triage/board
// Returns tickets, team members, and SLA stats for the triage kanban board.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();

  // ---- 1. Active escalation tickets ----------------------------------------
  // Include both new-style (escalation_stage != 'none') AND legacy tickets
  // where escalation_stage is still 'none' but escalation_status is 'pending'.
  const { data: sessions, error: sessionsError } = await supabase
    .from("conversation_sessions")
    .select(
      "id, phone_e164, user_id, escalation_stage, escalation_status, escalation_priority, " +
        "escalation_category, escalation_reason, escalated_at, " +
        "escalation_sla_deadline, escalation_assigned_to, linked_task_id, last_message_at",
    )
    .or("escalation_stage.neq.none,and(escalation_stage.eq.none,escalation_status.eq.pending)")
    .order("escalated_at", { ascending: false })
    .limit(500);

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const rows = (sessions ?? []) as unknown as SessionRow[];

  // ---- 2. Collect unique IDs to batch-fetch related data ------------------
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean) as string[])];
  const assigneeIds = [
    ...new Set(rows.map((r) => r.escalation_assigned_to).filter(Boolean) as string[]),
  ];
  const taskIds = [...new Set(rows.map((r) => r.linked_task_id).filter(Boolean) as string[])];
  const phones = [...new Set(rows.map((r) => r.phone_e164))];

  // ---- 3. Batch fetch user display names (for conversation owner) ----------
  const userMap = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("whatsapp_users")
      .select("id, display_name")
      .in("id", userIds);
    for (const u of (users ?? []) as UserRow[]) {
      userMap.set(u.id, u.display_name);
    }
  }

  // ---- 4. Batch fetch assignee display names ------------------------------
  const assigneeMap = new Map<string, string | null>();
  // Reuse userMap for any overlap; only fetch the delta
  const missingAssigneeIds = assigneeIds.filter((id) => !userMap.has(id));
  if (missingAssigneeIds.length > 0) {
    const { data: assignees } = await supabase
      .from("whatsapp_users")
      .select("id, display_name")
      .in("id", missingAssigneeIds);
    for (const u of (assignees ?? []) as UserRow[]) {
      assigneeMap.set(u.id, u.display_name);
    }
  }
  // Unified lookup: check assigneeMap first, fall back to userMap
  const getAssigneeName = (id: string | null): string | null => {
    if (!id) return null;
    if (assigneeMap.has(id)) return assigneeMap.get(id) ?? null;
    if (userMap.has(id)) return userMap.get(id) ?? null;
    return null;
  };

  // ---- 5. Batch fetch linked task data ------------------------------------
  const taskMap = new Map<string, TaskRow>();
  const deptMap = new Map<string, string>();

  if (taskIds.length > 0) {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, title, status, department_id")
      .in("id", taskIds);

    const deptIds = [
      ...new Set(
        (tasks ?? [])
          .map((t: TaskRow) => t.department_id)
          .filter(Boolean) as string[],
      ),
    ];

    // Batch fetch department names
    if (deptIds.length > 0) {
      const { data: depts } = await supabase
        .from("departments")
        .select("id, name")
        .in("id", deptIds);
      for (const d of (depts ?? []) as DeptRow[]) {
        deptMap.set(d.id, d.name);
      }
    }

    for (const t of (tasks ?? []) as TaskRow[]) {
      taskMap.set(t.id, t);
    }
  }

  // ---- 6. Batch fetch last inbound message per phone ----------------------
  const lastMessageMap = new Map<string, string | null>();
  if (phones.length > 0) {
    // Supabase JS client does not have DISTINCT ON, so we batch-fetch and
    // de-duplicate in JS (one pass). 500 escalations × low message count = fine.
    const { data: msgs } = await supabase
      .from("messages")
      .select("phone_e164, body, created_at")
      .in("phone_e164", phones)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(phones.length * 5); // generous bound; we only keep the latest per phone

    for (const m of (msgs ?? []) as MessageRow[]) {
      if (!lastMessageMap.has(m.phone_e164)) {
        lastMessageMap.set(m.phone_e164, m.body);
      }
    }
  }

  // ---- 7. Build ticket list -----------------------------------------------
  const tickets = rows.map((r) => {
    const user = r.user_id ? userMap.get(r.user_id) ?? null : null;
    const task = r.linked_task_id ? taskMap.get(r.linked_task_id) ?? null : null;
    const deptName = task?.department_id ? deptMap.get(task.department_id) ?? null : null;

    // Normalize legacy tickets: if escalation_stage is 'none' but escalation_status
    // is 'pending', treat it as stage 'pending' for the triage board.
    const stage =
      r.escalation_stage === "none" && r.escalation_status === "pending"
        ? "pending"
        : r.escalation_stage;

    return {
      session_id: r.id,
      phone_e164: r.phone_e164,
      display_name: user ?? r.phone_e164,
      escalation_stage: stage,
      escalation_priority: r.escalation_priority ?? "normal",
      escalation_category: r.escalation_category ?? "uncategorized",
      escalation_reason: r.escalation_reason,
      escalated_at: r.escalated_at,
      escalation_sla_deadline: r.escalation_sla_deadline,
      escalation_assigned_to: r.escalation_assigned_to,
      assignee_name: getAssigneeName(r.escalation_assigned_to),
      linked_task_id: r.linked_task_id,
      linked_task_title: task?.title ?? null,
      linked_task_status: task?.status ?? null,
      linked_task_department: deptName,
      last_inbound_message: lastMessageMap.get(r.phone_e164) ?? null,
      // message_count is expensive to compute per-ticket; return 0 as a placeholder
      // (the board can fetch counts lazily per conversation if needed).
      message_count: 0,
    };
  });

  // ---- 8. Team members: escalation_support_members UNION helpdesk users ---
  const teamMemberMap = new Map<string, string>();

  // 8a. Explicit support members
  const { data: supportMembers } = await supabase
    .from("escalation_support_members")
    .select("user_id, whatsapp_users!escalation_support_members_user_id_fkey(display_name)");

  for (const m of (supportMembers ?? []) as unknown as SupportMemberRow[]) {
    const wu = Array.isArray(m.whatsapp_users) ? m.whatsapp_users[0] : m.whatsapp_users;
    const name = wu?.display_name ?? null;
    teamMemberMap.set(m.user_id, name ?? m.user_id);
  }

  // 8b. Helpdesk-role users
  const { data: helpdeskUsers } = await supabase
    .from("whatsapp_users")
    .select("id, display_name")
    .eq("role", "helpdesk");

  for (const u of (helpdeskUsers ?? []) as UserRow[]) {
    if (!teamMemberMap.has(u.id)) {
      teamMemberMap.set(u.id, u.display_name ?? u.id);
    }
  }

  const team_members = [...teamMemberMap.entries()].map(([user_id, display_name]) => ({
    user_id,
    display_name,
  }));

  // ---- 9. SLA stats -------------------------------------------------------
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  const activeStages = ["pending", "picked_up", "waiting_on_department"] as const;
  const activeTickets = tickets.filter((t) => (activeStages as readonly string[]).includes(t.escalation_stage));

  const open_count = activeTickets.filter((t) => t.escalation_stage === "pending").length;
  const pending_count = activeTickets.filter(
    (t) => t.escalation_stage === "picked_up" || t.escalation_stage === "waiting_on_department",
  ).length;
  const breaching_count = activeTickets.filter(
    (t) => t.escalation_sla_deadline && new Date(t.escalation_sla_deadline) < now,
  ).length;

  // Resolved in the last 24 h (use all sessions including resolved)
  const { data: resolvedRows } = await supabase
    .from("conversation_sessions")
    .select("id")
    .eq("escalation_stage", "resolved")
    .gte("escalated_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

  const resolved_today_count = (resolvedRows ?? []).length;

  // Avg pickup time: today's picked_up activity log entries cross-referenced with escalated_at
  const { data: pickupLog } = await supabase
    .from("escalation_activity_log")
    .select("conversation_session_id, created_at")
    .eq("action", "picked_up")
    .gte("created_at", todayStartIso);

  let avg_pickup_minutes: number | null = null;
  if (pickupLog && pickupLog.length > 0) {
    const sessionEscalatedAt = new Map<string, string | null>();
    for (const r of rows) {
      sessionEscalatedAt.set(r.id, r.escalated_at);
    }

    // For sessions not in the current active list, we may need to fetch them
    const missingSessionIds = (pickupLog as ActivityRow[])
      .map((a) => a.conversation_session_id)
      .filter((id): id is string => id !== null && !sessionEscalatedAt.has(id));

    if (missingSessionIds.length > 0) {
      const { data: extraSessions } = await supabase
        .from("conversation_sessions")
        .select("id, escalated_at")
        .in("id", missingSessionIds);
      for (const s of (extraSessions ?? []) as { id: string; escalated_at: string | null }[]) {
        sessionEscalatedAt.set(s.id, s.escalated_at);
      }
    }

    const deltas: number[] = [];
    for (const entry of pickupLog as ActivityRow[]) {
      if (!entry.conversation_session_id) continue;
      const escalatedAt = sessionEscalatedAt.get(entry.conversation_session_id);
      if (!escalatedAt) continue;
      const delta =
        (new Date(entry.created_at).getTime() - new Date(escalatedAt).getTime()) / 60_000;
      if (delta >= 0) deltas.push(delta);
    }

    if (deltas.length > 0) {
      avg_pickup_minutes = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
    }
  }

  const sla_stats = {
    open_count,
    pending_count,
    breaching_count,
    avg_pickup_minutes,
    resolved_today_count,
  };

  return NextResponse.json({ tickets, team_members, sla_stats });
}
