import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { countUnreadInbound, groupRowsByPhoneChronologically } from "@/lib/admin/conversations";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type MessageRow = {
  id: string;
  phone_e164: string;
  direction: "inbound" | "outbound";
  body: string | null;
  message_type: string | null;
  whatsapp_message_id: string | null;
  created_at: string;
  raw_payload: unknown;
};

type ToolAuditRow = {
  id: string;
  phone_e164: string | null;
  tool_name: string;
  arguments: unknown;
  allowed: boolean;
  result_summary: string | null;
  created_at: string;
};

type UserRelation = {
  id: string;
  display_name: string | null;
  phone_e164: string;
  email: string | null;
  role: string | null;
  global_role: string | null;
} | null;

type SessionRow = {
  id: string;
  phone_e164: string;
  user_id: string | null;
  current_intent: string | null;
  state: unknown;
  last_message_at: string;
  created_at: string;
  handling_mode?: "ai" | "manual" | null;
  handling_mode_at?: string | null;
  escalation_status?: "none" | "pending" | "resolved" | null;
  escalation_reason?: string | null;
  escalation_priority?: "normal" | "urgent" | null;
  escalation_category?: string | null;
  escalated_at?: string | null;
  escalation_stage?: string | null;
  escalation_assigned_to?: string | null;
  escalation_assigned_at?: string | null;
  escalation_sla_deadline?: string | null;
  linked_issue_id?: string | null;
  quality_score?: "good" | "poor" | null;
  quality_reason?: string | null;
  quality_analyzed_at?: string | null;
  user?: UserRelation | UserRelation[];
  assigned_user?: UserRelation | UserRelation[];
  issue?: { id: string; issue_number: number; title: string } | Array<{ id: string; issue_number: number; title: string }> | null;
};

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();
  const selectedPhone = req.nextUrl.searchParams.get("phone");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 75) || 75, 200);

  const sessionColumns = "id, phone_e164, user_id, current_intent, state, last_message_at, created_at, handling_mode, handling_mode_at, escalation_status, escalation_reason, escalation_priority, escalation_category, escalated_at, escalation_stage, escalation_assigned_to, escalation_assigned_at, escalation_sla_deadline, linked_issue_id, quality_score, quality_reason, quality_analyzed_at, user:whatsapp_users!conversation_sessions_user_id_fkey(id, display_name, phone_e164, email, role, global_role), assigned_user:whatsapp_users!conversation_sessions_escalation_assigned_to_fkey(id, display_name, phone_e164, email, role, global_role), issue:issues!conversation_sessions_linked_issue_id_fkey(id, issue_number, title)";

  let sessionsQuery = supabase
    .from("conversation_sessions")
    .select(sessionColumns)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (selectedPhone) {
    sessionsQuery = sessionsQuery.eq("phone_e164", selectedPhone);
  }

  // Fetch recent sessions + ALL pending escalations in parallel so the
  // Escalations tab always shows every open ticket, not just those within
  // the recent-conversations window.
  const escalationsQuery = selectedPhone
    ? null
    : supabase
        .from("conversation_sessions")
        .select(sessionColumns)
        .eq("escalation_status", "pending")
        .order("last_message_at", { ascending: false });

  const [recentResult, escalationResult] = await Promise.all([
    sessionsQuery,
    escalationsQuery ?? Promise.resolve({ data: [] as SessionRow[], error: null }),
  ]);

  if (recentResult.error) {
    return NextResponse.json({ error: recentResult.error.message }, { status: 500 });
  }
  if (escalationResult.error) {
    return NextResponse.json({ error: escalationResult.error.message }, { status: 500 });
  }

  // Merge & deduplicate: pending escalations that fall outside the recent
  // window still appear so the sidebar and KPI strip agree.
  const seenIds = new Set(((recentResult.data ?? []) as SessionRow[]).map((s) => s.id));
  const extra = ((escalationResult.data ?? []) as SessionRow[]).filter((s) => !seenIds.has(s.id));
  const sessions = [...(recentResult.data ?? []) as SessionRow[], ...extra];

  const phoneNumbers = ((sessions ?? []) as SessionRow[]).map((session) => session.phone_e164);
  if (phoneNumbers.length === 0) {
    return NextResponse.json({ conversations: [] });
  }

  const [{ data: messages, error: messagesError }, { data: toolCalls, error: toolError }] =
    await Promise.all([
      supabase
        .from("messages")
        .select("id, phone_e164, direction, body, message_type, whatsapp_message_id, created_at, raw_payload")
        .in("phone_e164", phoneNumbers)
        .order("created_at", { ascending: false })
        .limit(selectedPhone ? 300 : 1000),
      supabase
        .from("tool_audit_logs")
        .select("id, phone_e164, tool_name, arguments, allowed, result_summary, created_at")
        .in("phone_e164", phoneNumbers)
        .order("created_at", { ascending: false })
        .limit(selectedPhone ? 200 : 500),
    ]);

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }
  if (toolError) {
    return NextResponse.json({ error: toolError.message }, { status: 500 });
  }

  const messagesByPhone = groupRowsByPhoneChronologically((messages ?? []) as MessageRow[]);
  const toolsByPhone = groupRowsByPhoneChronologically((toolCalls ?? []) as ToolAuditRow[]);

  const conversations = ((sessions ?? []) as SessionRow[]).map((session) => {
    const user = Array.isArray(session.user) ? session.user[0] : session.user;
    const assignedUser = Array.isArray(session.assigned_user) ? session.assigned_user[0] : session.assigned_user;
    const linkedIssue = Array.isArray(session.issue) ? session.issue[0] : session.issue;
    const sessionMessages = messagesByPhone.get(session.phone_e164) ?? [];
    const lastMessage = sessionMessages[sessionMessages.length - 1] ?? null;
    const unreadCount = countUnreadInbound(sessionMessages);

    return {
      id: session.id,
      phone_e164: session.phone_e164,
      display_name: user?.display_name ?? null,
      email: user?.email ?? null,
      role: user?.role ?? null,
      global_role: user?.global_role ?? null,
      current_intent: session.current_intent,
      handling_mode: session.handling_mode ?? "ai",
      handling_mode_at: session.handling_mode_at ?? null,
      escalation_status: session.escalation_status ?? "none",
      escalation_reason: session.escalation_reason ?? null,
      escalation_priority: session.escalation_priority ?? "normal",
      escalation_category: session.escalation_category ?? null,
      escalated_at: session.escalated_at ?? null,
      escalation_stage: session.escalation_stage ?? "none",
      escalation_assigned_to: session.escalation_assigned_to ?? null,
      assignee_name: assignedUser?.display_name ?? null,
      escalation_sla_deadline: session.escalation_sla_deadline ?? null,
      linked_issue_id: session.linked_issue_id ?? null,
      linked_issue_number: linkedIssue?.issue_number ?? null,
      linked_issue_title: linkedIssue?.title ?? null,
      quality_score: session.quality_score ?? null,
      quality_reason: session.quality_reason ?? null,
      quality_analyzed_at: session.quality_analyzed_at ?? null,
      last_message_at: session.last_message_at,
      created_at: session.created_at,
      last_message: lastMessage,
      unread_inbound_count: unreadCount,
      messages: sessionMessages,
      tool_calls: toolsByPhone.get(session.phone_e164) ?? [],
    };
  });

  return NextResponse.json({ conversations });
}
