import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { countUnreadInbound, groupRowsByPhoneChronologically } from "@/lib/admin/conversations";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { RELIGIOUS_TOOL_NAMES } from "@/lib/admin/religious-transcript";
import { getAccounts, getBroadcastAccount, getPrimaryAccount } from "@/lib/whatsapp/accounts";

type MessageRow = {
  id: string;
  phone_e164: string;
  direction: "inbound" | "outbound";
  body: string | null;
  message_type: string | null;
  whatsapp_message_id: string | null;
  created_at: string;
  raw_payload: unknown;
  // Which WABA number this message went to/from (NULL = primary). Maps to an account via `accounts`.
  phone_number_id: string | null;
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

// Public account directory for the inbox: maps each message's phone_number_id to a human label so
// the UI can show which WABA number a message went to/from. Cheap (2-3 env-backed entries, built
// once per request); falls back to [] if accounts aren't configured (e.g. in tests). NULL
// phone_number_id on a message means the primary account.
function resolveAccountsForResponse(): Array<{
  phoneNumberId: string;
  label: string;
  displayNumber: string | null;
  isPrimary: boolean;
}> {
  try {
    const primaryId = getPrimaryAccount().phoneNumberId;
    return getAccounts().map((a) => ({
      phoneNumberId: a.phoneNumberId,
      label: a.label,
      displayNumber: a.displayNumber ?? null,
      isPrimary: a.phoneNumberId === primaryId,
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();
  const selectedPhone = req.nextUrl.searchParams.get("phone");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 75) || 75, 200);

  // Inbox split by the number a conversation is on. `niyaz` = only the broadcast/niyaz RSVP number;
  // `main` (default) = everything else (NULL primary + any other number). When no broadcast account
  // is configured, `main` is unfiltered and `niyaz` is empty.
  const scope = req.nextUrl.searchParams.get("scope") === "niyaz" ? "niyaz" : "main";
  const broadcastPhoneNumberId = getBroadcastAccount()?.phoneNumberId ?? null;
  // PostgREST scope filter for a conversation_sessions query (string passed to .or()/.eq()).
  // niyaz: only the broadcast number; main: NULL or any non-broadcast number. Empty when no broadcast
  // account is configured and scope=niyaz (matches nothing).
  const scopeOr =
    broadcastPhoneNumberId && scope === "main"
      ? `phone_number_id.is.null,phone_number_id.neq.${broadcastPhoneNumberId}`
      : null;
  const scopeEq = scope === "niyaz" ? broadcastPhoneNumberId ?? "__none__" : null;

  const sessionColumns = "id, phone_e164, user_id, current_intent, state, last_message_at, created_at, handling_mode, handling_mode_at, escalation_status, escalation_reason, escalation_priority, escalation_category, escalated_at, escalation_stage, escalation_assigned_to, escalation_assigned_at, escalation_sla_deadline, linked_issue_id, quality_score, quality_reason, quality_analyzed_at, user:whatsapp_users!conversation_sessions_user_id_fkey(id, display_name, phone_e164, email, role, global_role), assigned_user:whatsapp_users!conversation_sessions_escalation_assigned_to_fkey(id, display_name, phone_e164, email, role, global_role), issue:issues!conversation_sessions_linked_issue_id_fkey(id, issue_number, title)";

  let sessionsQuery = supabase
    .from("conversation_sessions")
    .select(sessionColumns)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (selectedPhone) {
    sessionsQuery = sessionsQuery.eq("phone_e164", selectedPhone);
  } else {
    if (scopeOr) sessionsQuery = sessionsQuery.or(scopeOr);
    if (scopeEq) sessionsQuery = sessionsQuery.eq("phone_number_id", scopeEq);
  }

  // Fetch recent sessions + ALL pending escalations in parallel so the
  // Escalations tab always shows every open ticket, not just those within
  // the recent-conversations window.
  //
  // Escalations are cross-cutting: in the default `main` inbox they surface regardless of which
  // number they arrived on — people reply to broadcast blasts and the AI escalates those too, and
  // a breaching ticket must not be hidden just because it's on the broadcast number. So we do NOT
  // apply the `main` scope exclusion (scopeOr) here. The `niyaz` scope still narrows to its own
  // number (scopeEq) so that view stays focused.
  let escalationsQuery = selectedPhone
    ? null
    : supabase
        .from("conversation_sessions")
        .select(sessionColumns)
        .eq("escalation_status", "pending")
        .order("last_message_at", { ascending: false });
  if (escalationsQuery && scopeEq) {
    escalationsQuery = escalationsQuery.eq("phone_number_id", scopeEq);
  }

  // Resolved escalations belong to the Escalations tab too (the team browses them, and an
  // issue's "View" link must reach them). Load them only when asked (?includeResolved=1),
  // bounded to the most-recent `resolvedLimit` for the "load more" paging.
  const includeResolved = req.nextUrl.searchParams.get("includeResolved") === "1";
  const resolvedLimit = Math.min(
    Number(req.nextUrl.searchParams.get("resolvedLimit") ?? 50) || 50,
    500,
  );
  let resolvedQuery =
    selectedPhone || !includeResolved
      ? null
      : supabase
          .from("conversation_sessions")
          .select(sessionColumns)
          .eq("escalation_status", "resolved")
          .order("last_message_at", { ascending: false })
          .range(0, resolvedLimit - 1);
  // Same cross-scope rule as pending escalations above: don't apply the `main` exclusion.
  if (resolvedQuery && scopeEq) {
    resolvedQuery = resolvedQuery.eq("phone_number_id", scopeEq);
  }

  const [recentResult, escalationResult, resolvedResult] = await Promise.all([
    sessionsQuery,
    escalationsQuery ?? Promise.resolve({ data: [] as SessionRow[], error: null }),
    resolvedQuery ?? Promise.resolve({ data: [] as SessionRow[], error: null }),
  ]);

  if (recentResult.error) {
    return NextResponse.json({ error: recentResult.error.message }, { status: 500 });
  }
  if (escalationResult.error) {
    return NextResponse.json({ error: escalationResult.error.message }, { status: 500 });
  }
  if (resolvedResult.error) {
    return NextResponse.json({ error: resolvedResult.error.message }, { status: 500 });
  }

  // Always include resolved escalations linked to an issue (regardless of window or the
  // includeResolved toggle) so every issue's "View" target is present. Linkage lives in the
  // junction table — the denormalized linked_issue_id is unreliable.
  let issueLinkedResolved: SessionRow[] = [];
  if (!selectedPhone) {
    const { data: linkRows } = await supabase
      .from("issue_escalation_links")
      .select("conversation_session_id");
    const linkedIds = [
      ...new Set(((linkRows ?? []) as { conversation_session_id: string }[]).map((r) => r.conversation_session_id)),
    ];
    if (linkedIds.length > 0) {
      const { data: linkedSessions } = await supabase
        .from("conversation_sessions")
        .select(sessionColumns)
        .in("id", linkedIds)
        .eq("escalation_status", "resolved");
      issueLinkedResolved = (linkedSessions ?? []) as SessionRow[];
    }
  }

  // Merge & deduplicate: escalations outside the recent window still appear so the
  // sidebar and KPI strip agree.
  const seenIds = new Set(((recentResult.data ?? []) as SessionRow[]).map((s) => s.id));
  const supplemental = [
    ...((escalationResult.data ?? []) as SessionRow[]),
    ...((resolvedResult.data ?? []) as SessionRow[]),
    ...issueLinkedResolved,
  ];
  const extra: SessionRow[] = [];
  for (const s of supplemental) {
    if (!seenIds.has(s.id)) {
      seenIds.add(s.id);
      extra.push(s);
    }
  }
  const sessions = [...(recentResult.data ?? []) as SessionRow[], ...extra];
  const resolvedHasMore = ((resolvedResult.data ?? []) as SessionRow[]).length >= resolvedLimit;

  // `?religious=1`: also load EVERY conversation that used a religious/Lisan tool — even if it
  // falls outside the recent window — so the "Religious / Lisan tool used" filter shows all of
  // them, not just the few in the recent list.
  if (!selectedPhone && req.nextUrl.searchParams.get("religious")) {
    const { data: relRows } = await supabase
      .from("tool_audit_logs")
      .select("phone_e164")
      .in("tool_name", RELIGIOUS_TOOL_NAMES as unknown as string[])
      .not("phone_e164", "is", null)
      .limit(5000);
    const relPhones = [...new Set(((relRows ?? []) as { phone_e164: string }[]).map((r) => r.phone_e164))];
    if (relPhones.length) {
      const { data: relSessions } = await supabase
        .from("conversation_sessions")
        .select(sessionColumns)
        .in("phone_e164", relPhones)
        .order("last_message_at", { ascending: false })
        .limit(500);
      const have = new Set(sessions.map((s) => s.id));
      for (const s of (relSessions ?? []) as SessionRow[]) {
        if (!have.has(s.id)) {
          sessions.push(s);
          have.add(s.id);
        }
      }
    }
  }

  const phoneNumbers = ((sessions ?? []) as SessionRow[]).map((session) => session.phone_e164);
  if (phoneNumbers.length === 0) {
    return NextResponse.json({ conversations: [], resolved_has_more: resolvedHasMore, accounts: resolveAccountsForResponse() });
  }

  const [{ data: messages, error: messagesError }, { data: toolCalls, error: toolError }] =
    await Promise.all([
      supabase
        .from("messages")
        .select("id, phone_e164, direction, body, message_type, whatsapp_message_id, created_at, raw_payload, phone_number_id")
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

  // Reliable "religious/Lisan tool used" flag — independent of the truncated tool_calls window
  // above (which caps total rows). One narrow query over the loaded phones.
  const { data: religiousRows } = await supabase
    .from("tool_audit_logs")
    .select("phone_e164")
    .in("phone_e164", phoneNumbers)
    .in("tool_name", RELIGIOUS_TOOL_NAMES as unknown as string[]);
  const religiousPhones = new Set(
    ((religiousRows ?? []) as { phone_e164: string }[]).map((r) => r.phone_e164),
  );

  // Latest CONVERSATIONAL message per loaded phone — skipping template sends (RSVP/feedback/digests/
  // notifications) and RSVP/feedback button/flow responses. Powers (a) the "Broadcast-only" filter
  // (a phone with none is broadcast-only) and (b) the list preview/timestamp/sort, so a thread shows
  // its last REAL message — not a later broadcast that bumped it. Scoped to the loaded phones and
  // ordered newest-first, so the first row seen per phone is its latest conversational message.
  const { data: convoRows } = await supabase
    .from("messages")
    .select("phone_e164, body, created_at")
    .in("phone_e164", phoneNumbers)
    .is("raw_payload->>template", null)
    .not("message_type", "in", "(interactive,button)")
    .order("created_at", { ascending: false })
    .limit(5000);
  const lastConvoByPhone = new Map<string, { body: string | null; created_at: string }>();
  for (const r of (convoRows ?? []) as { phone_e164: string; body: string | null; created_at: string }[]) {
    if (!lastConvoByPhone.has(r.phone_e164)) lastConvoByPhone.set(r.phone_e164, { body: r.body, created_at: r.created_at });
  }

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
      used_religious_tool: religiousPhones.has(session.phone_e164),
      // False = "Broadcast-only" — the thread has no real message (RSVP/feedback broadcasts only).
      has_conversational_message: lastConvoByPhone.has(session.phone_e164),
      // Latest real (non-broadcast) message — drives list preview/timestamp/sort so a thread reflects
      // its last conversation, not a later broadcast. Null for broadcast-only threads.
      conversational_last_message: lastConvoByPhone.get(session.phone_e164) ?? null,
    };
  });

  return NextResponse.json({ conversations, resolved_has_more: resolvedHasMore, accounts: resolveAccountsForResponse() });
}
