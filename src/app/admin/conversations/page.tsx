"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { canAccessInbox, isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import CloseIssueModal from "@/components/admin/CloseIssueModal";
import QuickEditModal from "@/components/admin/QuickEditModal";

type HandlingMode = "ai" | "manual";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  message_type: string | null;
  whatsapp_message_id: string | null;
  created_at: string;
  raw_payload: unknown;
};

type ToolCall = {
  id: string;
  tool_name: string;
  arguments: unknown;
  allowed: boolean;
  result_summary: string | null;
  created_at: string;
};

// Mirrors PublicSenderProfile from @/lib/mumineen/sender-profile (age + contacts stripped).
type SenderProfileMember = {
  full_name: string | null;
  gender: string | null;
  jamaat: string | null;
  city: string | null;
  local_mehman: string | null;
  category: string | null;
  title: string | null;
  not_attending: boolean;
  arrival_at: string | null;
  arrival_flight_no: string | null;
  airport: string | null;
  departure_at: string | null;
  rahat_seating: boolean;
  wheelchair: boolean;
  special_needs: string | null;
  wants_khidmat: boolean | null;
};

type SenderProfile = {
  in_roster: boolean;
  registration_status: string | null;
  member_count: number;
  member: SenderProfileMember | null;
  family: {
    acc_type: string | null;
    hotel_name: string | null;
    utaro_host_name: string | null;
    open_to_utaro: boolean | null;
    transport_mode: string | null;
    transport_detail: string | null;
  } | null;
};

type ProfileResponse = {
  profile: SenderProfile | null;
  global_role: string | null;
  departments: { name: string; role: string }[];
};

// Tool calls older than this fall behind the "historic" toggle so active
// troubleshooting only surfaces the recent ones.
const RECENT_TOOL_CALL_WINDOW_MS = 24 * 60 * 60 * 1000;

type Conversation = {
  id: string;
  phone_e164: string;
  display_name: string | null;
  email: string | null;
  role: string | null;
  global_role: string | null;
  current_intent: string | null;
  handling_mode: HandlingMode;
  handling_mode_at: string | null;
  escalation_status: "none" | "pending" | "resolved";
  escalation_reason: string | null;
  escalation_priority: "normal" | "urgent";
  escalation_category: string | null;
  escalated_at: string | null;
  escalation_stage: string;
  escalation_assigned_to: string | null;
  assignee_name: string | null;
  escalation_sla_deadline: string | null;
  linked_issue_id: string | null;
  linked_issue_number: number | null;
  linked_issue_title: string | null;
  last_message_at: string;
  last_message: Message | null;
  unread_inbound_count: number;
  messages: Message[];
  tool_calls: ToolCall[];
  quality_score: "good" | "poor" | null;
  quality_reason: string | null;
  quality_analyzed_at: string | null;
};

type SLAStats = {
  open_count: number;
  pending_count: number;
  breaching_count: number;
  avg_pickup_minutes: number | null;
  resolved_today_count: number;
};

type Issue = {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  escalation_count: number;
  breaching_count: number;
};

type IssueDetail = Issue & {
  creator_name: string | null;
};

type IssueEscalation = {
  link_id: string;
  linked_at: string;
  session_id: string;
  phone_e164: string;
  display_name: string | null;
  escalation_stage: string;
  escalation_priority: string;
  escalation_category: string;
  escalation_reason: string | null;
  escalated_at: string | null;
  escalation_sla_deadline: string | null;
  breaching: boolean;
};

type ActivityEntry = {
  id: string;
  action: string;
  actor_label: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

type EscalationFilters = {
  assignee: string;   // "all" | "mine" | "unassigned" | user_id
  priority: string;   // "all" | "urgent" | "normal"
  category: string;   // "all" | category string
  stage: string;      // "active" | "pending" | "picked_up"
};

type SupportMember = {
  id: string;
  user: { id: string; display_name: string | null; email: string | null; phone_e164: string };
};

const DEFAULT_ESCALATION_FILTERS: EscalationFilters = {
  assignee: "all",
  priority: "all",
  category: "all",
  stage: "active",
};

function loadSavedFilters(): EscalationFilters {
  if (typeof window === "undefined") return DEFAULT_ESCALATION_FILTERS;
  try {
    const saved = localStorage.getItem("inbox_escalation_filters");
    if (!saved) return DEFAULT_ESCALATION_FILTERS;
    const parsed = JSON.parse(saved) as Partial<EscalationFilters>;
    return { ...DEFAULT_ESCALATION_FILTERS, ...parsed };
  } catch {
    return DEFAULT_ESCALATION_FILTERS;
  }
}

export default function ConversationsPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Initialize selection/tab from the URL so escalation email deep links land
  // directly on the right thread (?phone=...&tab=escalations).
  const [selectedPhone, setSelectedPhone] = useState<string | null>(
    () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("phone")),
  );
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [savingEscalation, setSavingEscalation] = useState(false);
  const [tab, setTab] = useState<"conversations" | "escalations" | "issues">(() => {
    if (typeof window === "undefined") return "conversations";
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "escalations" || t === "issues") return t;
    return "conversations";
  });
  const [reply, setReply] = useState("");
  // Issues tab state
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueDetail, setIssueDetail] = useState<{ issue: IssueDetail; escalations: IssueEscalation[]; activities: ActivityEntry[] } | null>(null);
  const [issueDetailLoading, setIssueDetailLoading] = useState(false);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  // KPI stats
  const [slaStats, setSlaStats] = useState<SLAStats | null>(null);
  const [hasInboxAccess] = useState(() => canAccessInbox(readAdminUser()));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [qualityFilter, setQualityFilter] = useState<"all" | "poor">("all");
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagePaneRef = useRef<HTMLDivElement>(null);
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [showHistoricToolCalls, setShowHistoricToolCalls] = useState(false);
  const [canQuickEdit] = useState(() => isAdminOrLeadership(readAdminUser()));
  // AI suggestions for escalations
  const [suggestions, setSuggestions] = useState<{
    matching_issues: Array<{ id: string; issue_number: number; title: string; status: string; priority: string; department_name: string | null; relevance_reason: string }>;
    resolution_history: { summary: string; past_count: number } | null;
  } | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // Escalation filters + support members for assignee dropdown
  const [escalationFilters, setEscalationFilters] = useState<EscalationFilters>(loadSavedFilters);
  const [supportMembers, setSupportMembers] = useState<SupportMember[]>([]);
  const [claimingPhone, setClaimingPhone] = useState<string | null>(null);
  const currentUserId = useMemo(() => readAdminUser()?.id ?? null, []);

  const escalatedCount = useMemo(
    () => conversations.filter((conversation) => conversation.escalation_status === "pending").length,
    [conversations],
  );

  // Conversations tab KPI stats (non-escalated threads only).
  const conversationStats = useMemo(() => {
    const nonEsc = conversations.filter((c) => c.escalation_status !== "pending");
    return {
      total: nonEsc.length,
      unread: nonEsc.filter((c) => c.unread_inbound_count > 0).length,
      manual: nonEsc.filter((c) => c.handling_mode === "manual").length,
      ai: nonEsc.filter((c) => c.handling_mode === "ai").length,
      poor: nonEsc.filter((c) => c.quality_score === "poor").length,
    };
  }, [conversations]);

  // Issues tab KPI stats.
  const issueStats = useMemo(() => ({
    total: issues.length,
    urgent: issues.filter((i) => i.priority === "urgent").length,
    high: issues.filter((i) => i.priority === "high").length,
    breaching: issues.reduce((s, i) => s + i.breaching_count, 0),
    unassigned: issues.filter((i) => !i.assigned_to).length,
  }), [issues]);

  // Derive unique categories from escalation data for the category filter dropdown.
  const escalationCategories = useMemo(() => {
    const cats = new Set<string>();
    conversations.forEach((c) => {
      if (c.escalation_status === "pending" && c.escalation_category) cats.add(c.escalation_category);
    });
    return Array.from(cats).sort();
  }, [conversations]);

  // Persist escalation filters to localStorage.
  useEffect(() => {
    localStorage.setItem("inbox_escalation_filters", JSON.stringify(escalationFilters));
  }, [escalationFilters]);

  // Escalated threads live in the Escalations tab (urgent first, then by SLA deadline);
  // everything else stays in Conversations. Issues tab doesn't show conversations.
  const visibleConversations = useMemo(() => {
    if (tab === "issues") return [];
    const inEscalations = (c: Conversation) => c.escalation_status === "pending";
    const list = conversations.filter((c) => (tab === "escalations" ? inEscalations(c) : !inEscalations(c)));
    if (tab === "escalations") {
      // Apply escalation filters
      let filtered = list;

      // Stage filter
      if (escalationFilters.stage === "active") {
        filtered = filtered.filter((c) => c.escalation_stage !== "resolved");
      } else if (escalationFilters.stage !== "all") {
        filtered = filtered.filter((c) => c.escalation_stage === escalationFilters.stage);
      }

      // Assignee filter
      if (escalationFilters.assignee === "mine") {
        filtered = filtered.filter((c) => c.escalation_assigned_to === currentUserId);
      } else if (escalationFilters.assignee === "unassigned") {
        filtered = filtered.filter((c) => !c.escalation_assigned_to);
      } else if (escalationFilters.assignee !== "all") {
        filtered = filtered.filter((c) => c.escalation_assigned_to === escalationFilters.assignee);
      }

      // Priority filter
      if (escalationFilters.priority !== "all") {
        filtered = filtered.filter((c) => c.escalation_priority === escalationFilters.priority);
      }

      // Category filter
      if (escalationFilters.category !== "all") {
        filtered = filtered.filter((c) => c.escalation_category === escalationFilters.category);
      }

      return [...filtered].sort((a, b) => {
        // Primary: priority (urgent first)
        if (a.escalation_priority !== b.escalation_priority) {
          return a.escalation_priority === "urgent" ? -1 : 1;
        }
        // Secondary: SLA deadline ascending (closest to breaching first, nulls last)
        const aDeadline = a.escalation_sla_deadline ? new Date(a.escalation_sla_deadline).getTime() : Infinity;
        const bDeadline = b.escalation_sla_deadline ? new Date(b.escalation_sla_deadline).getTime() : Infinity;
        if (aDeadline !== bDeadline) return aDeadline - bDeadline;
        return b.last_message_at.localeCompare(a.last_message_at);
      });
    }
    return list;
  }, [conversations, tab, escalationFilters, currentUserId]);

  // Keyword search over the loaded chats: matches name, phone, and any message body.
  const searchedConversations = useMemo(() => {
    let list = visibleConversations;
    if (qualityFilter === "poor") {
      list = list.filter((c) => c.quality_score === "poor");
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      if ((c.display_name ?? "").toLowerCase().includes(q)) return true;
      if (c.phone_e164.toLowerCase().includes(q)) return true;
      if ((c.email ?? "").toLowerCase().includes(q)) return true;
      return c.messages.some((m) => (m.body ?? "").toLowerCase().includes(q));
    });
  }, [visibleConversations, search, qualityFilter]);

  const selected = useMemo(
    () => visibleConversations.find((conversation) => conversation.phone_e164 === selectedPhone) ?? searchedConversations[0] ?? visibleConversations[0] ?? null,
    [visibleConversations, searchedConversations, selectedPhone],
  );
  const latestMessageId = selected?.messages[selected.messages.length - 1]?.id ?? null;
  const unreadInboundCount = selected?.unread_inbound_count ?? 0;
  const unreadMessageStartIndex = selected
    ? Math.max(selected.messages.length - unreadInboundCount, 0)
    : Number.POSITIVE_INFINITY;

  // Split tool calls into recent (last 24h) and historic. The list is chronological
  // (oldest→newest); we render newest-first in each group.
  const { recentToolCalls, historicToolCalls } = useMemo(() => {
    const calls = selected?.tool_calls ?? [];
    const cutoff = Date.now() - RECENT_TOOL_CALL_WINDOW_MS;
    const recent: ToolCall[] = [];
    const historic: ToolCall[] = [];
    for (const call of calls) {
      (new Date(call.created_at).getTime() >= cutoff ? recent : historic).push(call);
    }
    recent.reverse();
    historic.reverse();
    return { recentToolCalls: recent, historicToolCalls: historic };
  }, [selected?.tool_calls]);

  useEffect(() => {
    const pane = messagePaneRef.current;
    if (!pane) return;

    const frame = requestAnimationFrame(() => {
      pane.scrollTop = pane.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [selected?.phone_e164, latestMessageId]);

  // Load the selected sender's registration profile for the right-rail panel.
  // Reset the historic tool-call toggle whenever the conversation changes.
  useEffect(() => {
    const phone = selected?.phone_e164;
    let cancelled = false;

    async function loadProfile() {
      setShowHistoricToolCalls(false);
      if (!phone) {
        setProfile(null);
        return;
      }
      setProfileLoading(true);
      setProfile(null);
      try {
        const res = await apiFetch(`/api/admin/conversations/${encodeURIComponent(phone)}/profile`);
        const data = (await res.json().catch(() => null)) as ProfileResponse | null;
        if (!cancelled && res.ok) setProfile(data);
      } catch {
        // Non-critical panel; leave it empty on failure.
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };

  }, [selected?.phone_e164]);

  // Reset AI suggestions when switching conversations
  useEffect(() => {
    setSuggestions(null);
  }, [selected?.phone_e164]);

  async function loadSuggestions() {
    if (!selected?.phone_e164) return;
    setSuggestionsLoading(true);
    try {
      const res = await apiFetch(`/api/admin/escalations/${encodeURIComponent(selected.phone_e164)}/suggestions`);
      const data = await res.json().catch(() => null);
      if (res.ok && data) setSuggestions(data);
    } catch {
      // Non-critical; leave empty on failure.
    } finally {
      setSuggestionsLoading(false);
    }
  }

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      const here = window.location.pathname + window.location.search;
      router.push(`/admin/login?redirect=${encodeURIComponent(here)}`);
      return;
    }
    if (!canAccessInbox(user)) {
      // Registration Analytics is the universal internal landing page (tasks is manager-gated).
      router.push("/admin/registration");
      return;
    }

    void loadConversations();
    if (hasInboxAccess) {
      void fetchSlaStats();
      void fetchIssues();
      void fetchSupportMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Fetch issue detail when a specific issue is selected.
  useEffect(() => {
    if (!selectedIssueId) { setIssueDetail(null); return; }
    void fetchIssueDetail(selectedIssueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIssueId]);

  // Refresh issues when switching to the Issues tab.
  useEffect(() => {
    if (tab === "issues" && hasInboxAccess) void fetchIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Live updates via Server-Sent Events; the session cookie rides along automatically.
  useEffect(() => {
    const source = new EventSource("/api/admin/conversations/stream");
    source.onopen = () => { void refreshConversationsSilently(); if (hasInboxAccess) void fetchSlaStats(); };
    source.addEventListener("changed", () => { void refreshConversationsSilently(); if (hasInboxAccess) void fetchSlaStats(); });
    return () => source.close();
  }, []);

  // Backstop: refetch when the tab regains focus.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refreshConversationsSilently();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function loadConversations() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/conversations");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load conversations");
      }
      const items = (data.conversations ?? []) as Conversation[];
      setConversations(items);
      if (!selectedPhone && items[0]) setSelectedPhone(items[0].phone_e164);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }

  // Silent background refresh for near real-time updates. Does not toggle the
  // loading spinner, surface errors, or change the selected conversation.
  async function refreshConversationsSilently() {
    try {
      const res = await apiFetch("/api/admin/conversations");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setConversations((data.conversations ?? []) as Conversation[]);
    } catch {
      // Ignore transient polling failures.
    }
  }

  async function fetchSlaStats() {
    try {
      const res = await apiFetch("/api/admin/escalations/stats");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setSlaStats(data.stats ?? null);
    } catch { /* ignore */ }
  }

  async function fetchIssues() {
    try {
      const res = await apiFetch("/api/admin/issues?status=open");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setIssues((data.issues ?? []) as Issue[]);
    } catch { /* ignore */ }
  }

  async function fetchIssueDetail(issueId: string) {
    setIssueDetailLoading(true);
    try {
      const res = await apiFetch(`/api/admin/issues/${issueId}`);
      if (!res.ok) { setIssueDetail(null); return; }
      const data = await res.json().catch(() => ({}));
      setIssueDetail(data as { issue: IssueDetail; escalations: IssueEscalation[]; activities: ActivityEntry[] });
    } catch {
      setIssueDetail(null);
    } finally {
      setIssueDetailLoading(false);
    }
  }

  async function fetchSupportMembers() {
    try {
      const res = await apiFetch("/api/admin/escalation-support");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setSupportMembers((data.members ?? []) as SupportMember[]);
    } catch { /* ignore */ }
  }

  async function claimEscalation(phoneE164: string) {
    setClaimingPhone(phoneE164);
    try {
      const res = await apiFetch(`/api/admin/escalations/${encodeURIComponent(phoneE164)}/claim`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to claim escalation");
        return;
      }
      await refreshConversationsSilently();
      if (hasInboxAccess) void fetchSlaStats();
    } catch {
      setError("Failed to claim escalation");
    } finally {
      setClaimingPhone(null);
    }
  }

  async function releaseEscalation(phoneE164: string) {
    setClaimingPhone(phoneE164);
    try {
      const res = await apiFetch(`/api/admin/escalations/${encodeURIComponent(phoneE164)}/release`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to release escalation");
        return;
      }
      await refreshConversationsSilently();
      if (hasInboxAccess) void fetchSlaStats();
    } catch {
      setError("Failed to release escalation");
    } finally {
      setClaimingPhone(null);
    }
  }

  async function setMode(mode: HandlingMode) {
    if (!selected || selected.handling_mode === mode) return;
    setSavingMode(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/conversations/${encodeURIComponent(selected.phone_e164)}/mode`, {
        method: "PUT",
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update mode");
      }
      setConversations((items) =>
        items.map((item) =>
          item.phone_e164 === selected.phone_e164
            ? { ...item, handling_mode: mode, handling_mode_at: data.handling_mode_at ?? new Date().toISOString() }
            : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update mode");
    } finally {
      setSavingMode(false);
    }
  }

  async function resolveEscalation() {
    if (!selected) return;
    setSavingEscalation(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/escalations/${encodeURIComponent(selected.phone_e164)}/resolve`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to resolve escalation");
      }
      const phone = selected.phone_e164;
      setConversations((items) =>
        items.map((item) =>
          item.phone_e164 === phone ? { ...item, escalation_status: "resolved" } : item,
        ),
      );
      setSelectedPhone(phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve escalation");
    } finally {
      setSavingEscalation(false);
    }
  }

  async function reEscalate() {
    if (!selected) return;
    setSavingEscalation(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/conversations/${encodeURIComponent(selected.phone_e164)}/escalation`, {
        method: "PUT",
        body: JSON.stringify({ status: "pending" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to escalate");
      }
      const phone = selected.phone_e164;
      setConversations((items) =>
        items.map((item) =>
          item.phone_e164 === phone ? { ...item, escalation_status: "pending" } : item,
        ),
      );
      setSelectedPhone(phone);
      setTab("escalations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to escalate");
    } finally {
      setSavingEscalation(false);
    }
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || (!reply.trim() && !attachment)) return;
    setSending(true);
    setError(null);
    try {
      const path = `/api/admin/conversations/${encodeURIComponent(selected.phone_e164)}/messages`;
      let res: Response;
      if (attachment) {
        // Image attachment goes as multipart; let the browser set the boundary header.
        const form = new FormData();
        form.append("image", attachment);
        if (reply.trim()) form.append("caption", reply.trim());
        res = await apiFetch(path, { method: "POST", body: form });
      } else {
        res = await apiFetch(path, { method: "POST", body: JSON.stringify({ body: reply }) });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to send reply");
      }
      setReply("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  // Build a deep link to the open chat and copy it. The page already restores the thread
  // (and tab) from ?phone=&tab=; recipients land on the same conversation after login.
  async function shareChatLink() {
    if (!selected) return;
    const params = new URLSearchParams({
      phone: selected.phone_e164,
      tab: selected.escalation_status === "pending" ? "escalations" : "conversations",
    });
    const url = `${window.location.origin}/admin/conversations?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); surface the link to copy manually.
      setError(`Copy this link: ${url}`);
    }
  }

  async function linkToIssue(issueId: string) {
    if (!selected) return;
    const res = await apiFetch(`/api/admin/issues/${issueId}/link`, {
      method: "POST",
      body: JSON.stringify({ phone_e164: selected.phone_e164 }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Failed to link issue");
    }
    await Promise.all([refreshConversationsSilently(), fetchIssues()]);
  }

  async function unlinkFromIssue() {
    if (!selected?.linked_issue_id) return;
    const res = await apiFetch(`/api/admin/issues/${selected.linked_issue_id}/link`, {
      method: "DELETE",
      body: JSON.stringify({ phone_e164: selected.phone_e164 }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Failed to unlink issue");
    }
    await Promise.all([refreshConversationsSilently(), fetchIssues()]);
  }

  async function createAndLinkIssue(fields: { title: string; description?: string; priority: string; department_id?: string; assigned_to?: string }) {
    if (!selected) return;
    const createRes = await apiFetch("/api/admin/issues", {
      method: "POST",
      body: JSON.stringify(fields),
    });
    const createData = await createRes.json().catch(() => ({}));
    if (!createRes.ok) throw new Error(createData.error ?? "Failed to create issue");
    const issueId = createData.issue?.id;
    if (!issueId) throw new Error("No issue ID returned");
    await linkToIssue(issueId);
  }

  async function createStandaloneIssue(fields: { title: string; description?: string; priority?: string; department_id?: string; assigned_to?: string }) {
    const res = await apiFetch("/api/admin/issues", {
      method: "POST",
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Failed to create issue");
    await fetchIssues();
    const newId = data.issue?.id as string | undefined;
    if (newId) {
      setShowCreateIssue(false);
      setSelectedIssueId(newId);
    }
  }

  const isManual = selected?.handling_mode === "manual";

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}

        {/* KPI Strip — changes per active tab */}
        {hasInboxAccess && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {tab === "conversations" && (
              <>
                <span className="mr-1 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Conversations</span>
                <StatPill label="Total" value={conversationStats.total} />
                <StatPill label="Unread" value={conversationStats.unread} color={conversationStats.unread > 0 ? "red" : undefined} />
                <StatPill label="Manual" value={conversationStats.manual} color={conversationStats.manual > 0 ? "amber" : undefined} />
                <StatPill label="AI Handled" value={conversationStats.ai} color="green" />
                <StatPill label="Poor Quality" value={conversationStats.poor} color={conversationStats.poor > 0 ? "red" : undefined} />
              </>
            )}
            {tab === "escalations" && slaStats && (
              <>
                <span className="mr-1 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Escalations</span>
                <StatPill label="Open" value={slaStats.open_count} />
                <StatPill label="Pending" value={slaStats.pending_count} color={slaStats.pending_count > 0 ? "red" : undefined} />
                <StatPill label="Breaching" value={slaStats.breaching_count} color={slaStats.breaching_count > 0 ? "red" : undefined} pulse={slaStats.breaching_count > 0} />
                <StatPill label="Avg Pickup" value={slaStats.avg_pickup_minutes != null ? `${slaStats.avg_pickup_minutes}m` : "—"} color={slaStats.avg_pickup_minutes != null ? (slaStats.avg_pickup_minutes < 20 ? "green" : slaStats.avg_pickup_minutes < 45 ? "amber" : "red") : undefined} />
                <StatPill label="Resolved Today" value={slaStats.resolved_today_count} color="green" />
              </>
            )}
            {tab === "issues" && (
              <>
                <span className="mr-1 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Issues</span>
                <StatPill label="Open" value={issueStats.total} />
                <StatPill label="Urgent" value={issueStats.urgent} color={issueStats.urgent > 0 ? "red" : undefined} />
                <StatPill label="High" value={issueStats.high} color={issueStats.high > 0 ? "amber" : undefined} />
                <StatPill label="Breaching" value={issueStats.breaching} color={issueStats.breaching > 0 ? "red" : undefined} pulse={issueStats.breaching > 0} />
                <StatPill label="Unassigned" value={issueStats.unassigned} color={issueStats.unassigned > 0 ? "amber" : undefined} />
              </>
            )}
          </div>
        )}

        <div className="grid min-h-[600px] grid-cols-1 overflow-hidden rounded-lg border bg-white shadow-sm lg:h-[calc(100vh-7rem)] lg:min-h-[520px] lg:grid-cols-[320px_minmax(0,1fr)_320px] dark:border-gray-800 dark:bg-gray-900">
          <aside className="flex flex-col border-b bg-gray-50 lg:h-full lg:min-h-0 lg:border-b-0 lg:border-r dark:border-gray-800 dark:bg-gray-900/40">
            {/* ── Tab bar ── */}
            <div className="shrink-0 flex justify-evenly border-b bg-gray-100/60 dark:border-gray-800 dark:bg-gray-800/40">
              <button
                onClick={() => setTab("conversations")}
                className={`relative px-2 py-3 text-sm font-semibold transition-colors ${tab === "conversations" ? "text-blue-700 dark:text-blue-300" : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"}`}
              >
                Conversations
                {tab === "conversations" && <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-t bg-blue-600 dark:bg-blue-400" />}
              </button>
              <button
                onClick={() => setTab("escalations")}
                className={`relative flex items-center gap-1.5 px-2 py-3 text-sm font-semibold transition-colors ${tab === "escalations" ? "text-amber-700 dark:text-amber-300" : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"}`}
              >
                Escalations
                {escalatedCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{escalatedCount}</span>
                )}
                {tab === "escalations" && <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-t bg-amber-500 dark:bg-amber-400" />}
              </button>
              {hasInboxAccess && (
                <button
                  onClick={() => setTab("issues")}
                  className={`relative flex items-center gap-1.5 px-2 py-3 text-sm font-semibold transition-colors ${tab === "issues" ? "text-purple-700 dark:text-purple-300" : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"}`}
                >
                  Issues
                  {issues.length > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple-500 px-1.5 text-[11px] font-bold text-white">{issues.length}</span>
                  )}
                  {tab === "issues" && <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-t bg-purple-600 dark:bg-purple-400" />}
                </button>
              )}
            </div>

            {/* ── Search + Refresh row ── */}
            <div className="shrink-0 border-b px-4 py-2.5 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, number, or message…"
                    className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                      aria-label="Clear search"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button
                  onClick={() => void loadConversations()}
                  className="shrink-0 rounded-md border border-gray-200 p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:border-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  aria-label="Refresh"
                  title="Refresh"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={qualityFilter === "poor"}
                  onChange={(e) => setQualityFilter(e.target.checked ? "poor" : "all")}
                />
                Show only needs-review
              </label>
            </div>

            {/* ── Escalation filters ── */}
            {tab === "escalations" && (
              <div className="shrink-0 border-b px-4 py-2 dark:border-gray-800">
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={escalationFilters.assignee}
                    onChange={(e) => setEscalationFilters((f) => ({ ...f, assignee: e.target.value }))}
                    className={`rounded-md border px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${escalationFilters.assignee !== "all" ? "ring-1 ring-amber-400 dark:ring-amber-600" : ""}`}
                  >
                    <option value="all">All Assignees</option>
                    <option value="mine">Mine</option>
                    <option value="unassigned">Unassigned</option>
                    {supportMembers.length > 0 && <option disabled>───</option>}
                    {supportMembers.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.display_name || m.user.phone_e164}
                      </option>
                    ))}
                  </select>
                  <select
                    value={escalationFilters.priority}
                    onChange={(e) => setEscalationFilters((f) => ({ ...f, priority: e.target.value }))}
                    className={`rounded-md border px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${escalationFilters.priority !== "all" ? "ring-1 ring-amber-400 dark:ring-amber-600" : ""}`}
                  >
                    <option value="all">All Priorities</option>
                    <option value="urgent">Urgent</option>
                    <option value="normal">Normal</option>
                  </select>
                  <select
                    value={escalationFilters.category}
                    onChange={(e) => setEscalationFilters((f) => ({ ...f, category: e.target.value }))}
                    className={`rounded-md border px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${escalationFilters.category !== "all" ? "ring-1 ring-amber-400 dark:ring-amber-600" : ""}`}
                  >
                    <option value="all">All Categories</option>
                    {escalationCategories.map((cat) => (
                      <option key={cat} value={cat}>#{cat}</option>
                    ))}
                  </select>
                  <select
                    value={escalationFilters.stage}
                    onChange={(e) => setEscalationFilters((f) => ({ ...f, stage: e.target.value }))}
                    className={`rounded-md border px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${escalationFilters.stage !== "active" ? "ring-1 ring-amber-400 dark:ring-amber-600" : ""}`}
                  >
                    <option value="active">All Active</option>
                    <option value="pending">Pending</option>
                    <option value="picked_up">Picked Up</option>
                  </select>
                </div>
                {(escalationFilters.assignee !== "all" || escalationFilters.priority !== "all" || escalationFilters.category !== "all" || escalationFilters.stage !== "active") && (
                  <button
                    type="button"
                    onClick={() => setEscalationFilters(DEFAULT_ESCALATION_FILTERS)}
                    className="mt-1.5 text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
            <div className="max-h-[60vh] flex-1 overflow-y-auto lg:max-h-none lg:min-h-0">
              {tab === "issues" ? (
                <>
                  {/* New Issue button */}
                  <div className="shrink-0 border-b px-3 py-2 dark:border-gray-800">
                    <button
                      type="button"
                      onClick={() => { setShowCreateIssue(true); setSelectedIssueId(null); }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-purple-700 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
                      New Issue
                    </button>
                  </div>
                  {/* Issues list */}
                  {issues.length === 0 ? (
                    <p className="p-4 text-sm text-gray-500 dark:text-gray-400">No open issues.</p>
                  ) : (
                    issues.map((issue) => (
                      <button
                        key={issue.id}
                        onClick={() => { setSelectedIssueId(issue.id); setShowCreateIssue(false); }}
                      className={`block w-full border-b border-l-4 px-4 py-3 text-left dark:border-gray-800 ${
                        selectedIssueId === issue.id
                          ? "border-l-purple-600 bg-purple-50 dark:border-l-purple-400 dark:bg-gray-800"
                          : "border-l-transparent hover:bg-gray-100 dark:hover:bg-gray-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs font-semibold text-purple-600 dark:text-purple-400 font-mono">ISS-{issue.issue_number}</span>
                        <p className="font-medium break-words truncate">{issue.title}</p>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${issue.priority === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : issue.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                          {issue.priority.toUpperCase()}
                        </span>
                        {issue.department_name && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">{issue.department_name}</span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs ${issue.status === "resolved" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : issue.status === "in_progress" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                          {issue.status === "in_progress" ? "In Progress" : issue.status === "open" ? "Open" : "Resolved"}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span className={issue.breaching_count > 0 ? "text-red-600 font-semibold dark:text-red-400" : ""}>{issue.escalation_count} escalation{issue.escalation_count !== 1 ? "s" : ""}</span>
                        {issue.breaching_count > 0 && <span className="text-red-600 dark:text-red-400">{issue.breaching_count} breaching</span>}
                        <span>{formatDate(issue.created_at)}</span>
                      </div>
                    </button>
                  ))
                  )}
                </>
              ) : loading ? (
                <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
              ) : searchedConversations.length === 0 ? (
                <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                  {search.trim()
                    ? "No chats match your search."
                    : tab === "escalations" ? (
                      escalationFilters.assignee === "mine" ? (
                        <span>
                          No escalations assigned to you.{" "}
                          <button type="button" onClick={() => setEscalationFilters((f) => ({ ...f, assignee: "all" }))} className="text-amber-600 hover:underline dark:text-amber-400">Show all</button>
                        </span>
                      ) : escalationFilters.assignee === "unassigned" ? (
                        "All escalations have been claimed."
                      ) : (escalationFilters.assignee !== "all" || escalationFilters.priority !== "all" || escalationFilters.category !== "all" || escalationFilters.stage !== "active") ? (
                        <span>
                          No escalations match your filters.{" "}
                          <button type="button" onClick={() => setEscalationFilters(DEFAULT_ESCALATION_FILTERS)} className="text-amber-600 hover:underline dark:text-amber-400">Clear filters</button>
                        </span>
                      ) : "No escalations."
                    ) : "No conversations yet."}
                </div>
              ) : (
                searchedConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedPhone(conversation.phone_e164)}
                    className={`block w-full border-b border-l-4 px-4 py-3 text-left dark:border-gray-800 ${
                      selected?.phone_e164 === conversation.phone_e164
                        ? "border-l-blue-600 bg-blue-50 dark:border-l-blue-400 dark:bg-gray-800"
                        : "border-l-transparent hover:bg-gray-100 dark:hover:bg-gray-800/60"
                    }`}
                  >
                    <p className="font-medium break-words">{conversation.display_name || conversation.phone_e164}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {conversation.escalation_status === "pending" && (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${conversation.escalation_priority === "urgent" ? "bg-red-500 text-white" : "bg-amber-500 text-white"}`}>
                          {conversation.escalation_priority === "urgent" ? "URGENT" : "ESCALATED"}
                        </span>
                      )}
                      {tab === "escalations" && conversation.escalation_stage && conversation.escalation_stage !== "none" && (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${conversation.escalation_stage === "pending" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : conversation.escalation_stage === "picked_up" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                          {conversation.escalation_stage === "pending" ? "Pending" : conversation.escalation_stage === "picked_up" ? "Picked Up" : conversation.escalation_stage.replace(/_/g, " ")}
                        </span>
                      )}
                      {conversation.linked_issue_number && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">ISS-{conversation.linked_issue_number}</span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs ${conversation.role === "committee" || conversation.role === "admin" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"}`}>
                        {conversation.role === "committee" || conversation.role === "admin" ? "Member" : "External"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${conversation.handling_mode === "manual" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>
                        {conversation.handling_mode.toUpperCase()}
                      </span>
                    </div>
                    {conversation.escalation_status === "pending" && conversation.escalation_category && (
                      <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">#{conversation.escalation_category}</p>
                    )}
                    <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">{conversation.last_message?.body || "No message body"}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                      <div className="flex items-center gap-2">
                        {tab === "escalations" && conversation.escalation_sla_deadline ? (
                          <SLACountdown deadline={conversation.escalation_sla_deadline} />
                        ) : (
                          <span>{formatDate(conversation.last_message_at)}</span>
                        )}
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">{conversation.messages.length} msg{conversation.messages.length !== 1 ? "s" : ""}</span>
                      </div>
                      {tab === "escalations" && !conversation.escalation_assigned_to && (conversation.escalation_stage === "pending" || conversation.escalation_stage === "none") ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void claimEscalation(conversation.phone_e164); }}
                          disabled={claimingPhone === conversation.phone_e164}
                          className="rounded-md border border-amber-400 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 shadow-sm transition-colors hover:bg-amber-100 hover:border-amber-500 disabled:opacity-50 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-800/50"
                        >
                          {claimingPhone === conversation.phone_e164 ? "..." : "Pick Up"}
                        </button>
                      ) : tab === "escalations" && conversation.assignee_name ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{conversation.assignee_name}</span>
                      ) : conversation.unread_inbound_count > 0 ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/40 dark:text-green-300">{conversation.unread_inbound_count} new</span>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="flex min-h-[600px] flex-col lg:h-full lg:min-h-0">
            {tab === "issues" ? (
              // Issue detail panel or create form
              <div className="flex-1 overflow-y-auto p-5">
                {showCreateIssue ? (
                  <CreateIssuePanel
                    onSubmit={async (fields) => {
                      await createStandaloneIssue(fields);
                    }}
                    onCancel={() => setShowCreateIssue(false)}
                    onError={(msg) => setError(msg)}
                  />
                ) : !selectedIssueId ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Select an issue from the list, or create a new one.</p>
                ) : issueDetailLoading ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading issue...</p>
                ) : !issueDetail ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Issue not found.</p>
                ) : (
                  <IssueDetailPanel
                    detail={issueDetail}
                    onNavigateToEscalation={(phone) => { setTab("escalations"); setSelectedPhone(phone); }}
                    onRefresh={() => { void fetchIssueDetail(selectedIssueId); void fetchIssues(); }}
                  />
                )}
              </div>
            ) : (
            <>
            <div className="shrink-0 border-b px-5 py-3 dark:border-gray-800">
              {selected ? (
                <div className="space-y-2">
                  {/* Row 1: Name + primary actions */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold">{selected.display_name || selected.phone_e164}</h2>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{selected.phone_e164}{selected.email ? ` · ${selected.email}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {selected.escalation_status === "pending" && !selected.escalation_assigned_to && (
                        <button
                          type="button"
                          onClick={() => void claimEscalation(selected.phone_e164)}
                          disabled={claimingPhone === selected.phone_e164}
                          className="whitespace-nowrap rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                          {claimingPhone === selected.phone_e164 ? "Claiming…" : "Pick Up"}
                        </button>
                      )}
                      {selected.escalation_status === "pending" ? (
                        <button
                          type="button"
                          onClick={() => void resolveEscalation()}
                          disabled={savingEscalation}
                          className="whitespace-nowrap rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {savingEscalation ? "Resolving…" : "Resolve"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void reEscalate()}
                          disabled={savingEscalation}
                          className="whitespace-nowrap rounded-md border border-amber-500 px-3 py-1.5 text-sm font-medium text-amber-600 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                        >
                          {savingEscalation ? "Saving…" : "Escalate"}
                        </button>
                      )}
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-medium ${!isManual ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-gray-500"}`}>AI</span>
                        <button
                          type="button"
                          onClick={() => void setMode(isManual ? "ai" : "manual")}
                          disabled={savingMode}
                          role="switch"
                          aria-checked={isManual}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${isManual ? "bg-amber-500" : "bg-blue-600"} disabled:opacity-50`}
                          aria-label="Toggle manual mode"
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isManual ? "translate-x-6" : "translate-x-0.5"}`} />
                        </button>
                        <span className={`text-xs font-medium ${isManual ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-gray-500"}`}>Manual</span>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Escalation metadata bar (only for pending escalations) */}
                  {selected.escalation_status === "pending" && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {selected.escalation_priority === "urgent" && (
                        <span className="rounded-full bg-red-500 px-2 py-0.5 font-bold text-white">URGENT</span>
                      )}
                      {selected.escalation_category && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">#{selected.escalation_category}</span>
                      )}
                      {selected.escalation_assigned_to && (
                        selected.escalation_assigned_to === currentUserId ? (
                          <button
                            type="button"
                            onClick={() => void releaseEscalation(selected.phone_e164)}
                            disabled={claimingPhone === selected.phone_e164}
                            className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 transition-colors hover:bg-red-100 hover:text-red-700 disabled:opacity-50 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-red-900/40 dark:hover:text-red-300"
                            title="Release this escalation"
                          >
                            You
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                          </button>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">{selected.assignee_name}</span>
                        )
                      )}
                      {selected.escalation_sla_deadline && (
                        <span className="flex items-center gap-1">
                          <SLACountdown deadline={selected.escalation_sla_deadline} />
                        </span>
                      )}
                      <span className="mx-0.5 text-gray-300 dark:text-gray-600">|</span>
                      <IssueLinkControl
                        conversation={selected}
                        issues={issues}
                        onLink={linkToIssue}
                        onUnlink={unlinkFromIssue}
                        onCreate={createAndLinkIssue}
                        onError={(msg) => setError(msg)}
                        onNavigateToIssue={(id) => { setTab("issues"); setSelectedIssueId(id); }}
                      />
                      <button
                        type="button"
                        onClick={() => void shareChatLink()}
                        title="Copy a shareable link to this chat"
                        className="rounded-md px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                      >
                        {linkCopied ? "Copied!" : "Share"}
                      </button>
                      {selected.escalation_reason && (
                        <>
                          <span className="mx-0.5 text-gray-300 dark:text-gray-600">|</span>
                          <span className="truncate text-gray-500 dark:text-gray-400" title={selected.escalation_reason}>{selected.escalation_reason}</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Non-escalation: just show share + agent toggle context */}
                  {selected.escalation_status !== "pending" && (
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => void shareChatLink()}
                        title="Copy a shareable link to this chat"
                        className="rounded-md px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                      >
                        {linkCopied ? "Copied!" : "Share"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">Select a conversation.</p>
              )}
            </div>

            <div ref={messagePaneRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 p-5 dark:bg-gray-950/40">
              {selected?.messages.map((message, index) => {
                const isNewInbound =
                  unreadInboundCount > 0 &&
                  message.direction === "inbound" &&
                  index >= unreadMessageStartIndex;

                return (
                  <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] rounded-lg border px-4 py-3 shadow-sm ${
                      message.direction === "outbound"
                        ? "bg-blue-600 text-white dark:bg-blue-700"
                        : isNewInbound
                          ? "border-green-300 bg-green-50 text-gray-900 ring-2 ring-green-200 dark:border-green-700 dark:bg-green-950/40 dark:text-gray-100 dark:ring-green-900"
                          : "bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    }`}>
                      <MessageContent message={message} />
                      <div className={`mt-2 flex items-center gap-2 text-xs ${message.direction === "outbound" ? "text-blue-100" : isNewInbound ? "text-green-700 dark:text-green-300" : "text-gray-400 dark:text-gray-500"}`}>
                        <span>{formatDate(message.created_at)}</span>
                        {isNewInbound && <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 dark:bg-green-900 dark:text-green-200">New</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {selected && selected.messages.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No messages stored for this conversation.</p>}
            </div>

            <form onSubmit={sendReply} className="shrink-0 border-t bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Manual WhatsApp Reply</p>
                {selected?.handling_mode !== "manual" && <p className="text-xs text-amber-700 dark:text-amber-400">Switch to Manual before replying.</p>}
              </div>
              {attachment && (
                <div className="mb-2 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                  <span className="truncate">📎 {attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="ml-auto shrink-0 text-blue-600 hover:text-red-600 dark:text-blue-400 dark:hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!selected || selected.handling_mode !== "manual" || sending}
                  title="Attach an image"
                  className="shrink-0 rounded-md border px-3 text-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  📎
                </button>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={2}
                  disabled={!selected || selected.handling_mode !== "manual" || sending}
                  placeholder={attachment ? "Add a caption (optional)" : "Type a WhatsApp reply"}
                  className="min-h-[56px] flex-1 resize-none rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800/50"
                />
                <button
                  type="submit"
                  disabled={!selected || selected.handling_mode !== "manual" || (!reply.trim() && !attachment) || sending}
                  className="w-24 rounded-md bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                >
                  {sending ? "Sending" : "Send"}
                </button>
              </div>
            </form>
            </>
            )}
          </section>

          <aside className="flex flex-col border-t bg-white lg:h-full lg:min-h-0 lg:border-l lg:border-t-0 dark:border-gray-800 dark:bg-gray-900">
            {canQuickEdit && (
              <div className="shrink-0 border-b px-4 py-3 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowQuickEdit(true)}
                  className="w-full rounded-md border border-blue-500 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                >
                  Edit FAQ / Prompt
                </button>
              </div>
            )}
            <ProfilePanel profile={profile} loading={profileLoading} />
            {selected?.quality_score && (
              <div className="shrink-0 border-b px-4 py-3 dark:border-gray-800">
                <h2 className="font-semibold">Conversation Quality</h2>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-lg ${selected.quality_score === "good" ? "text-green-600" : "text-red-600"}`}>
                    {selected.quality_score === "good" ? "\u{1F44D}" : "\u{1F44E}"}
                  </span>
                  <span className={`text-sm font-medium ${selected.quality_score === "good" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {selected.quality_score === "good" ? "Good" : "Needs Improvement"}
                  </span>
                </div>
                {selected.quality_reason && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{selected.quality_reason}</p>
                )}
                {selected.quality_analyzed_at && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Analyzed {formatDate(selected.quality_analyzed_at)}</p>
                )}
              </div>
            )}
            {/* AI Suggestions — only on Escalations tab for pending escalations */}
            {tab === "escalations" && selected?.escalation_status === "pending" && (
              <div className="shrink-0 border-b px-4 py-3 dark:border-gray-800">
                <h2 className="font-semibold">AI Suggestions</h2>
                {!suggestions && !suggestionsLoading && (
                  <button
                    type="button"
                    onClick={() => void loadSuggestions()}
                    className="mt-2 w-full rounded-md border border-purple-500 px-3 py-2 text-sm font-medium text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/20"
                  >
                    Get AI Suggestions
                  </button>
                )}
                {suggestionsLoading && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 animate-pulse">Analyzing escalation...</p>
                )}
                {!suggestionsLoading && suggestions && (
                  <div className="mt-2 space-y-3">
                    {/* Matching Issues */}
                    {suggestions.matching_issues.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-gray-400">Related Issues</p>
                        <div className="mt-1 space-y-2">
                          {suggestions.matching_issues.map((issue) => {
                            const isLinked = selected?.linked_issue_id === issue.id;
                            return (
                              <div key={issue.id} className="rounded-md border bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">ISS-{issue.issue_number}</span>
                                    <span className="truncate text-sm font-medium">{issue.title}</span>
                                  </div>
                                  {isLinked ? (
                                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">Linked</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => { linkToIssue(issue.id).catch((err: unknown) => setError(err instanceof Error ? err.message : "Link failed")); }}
                                      className="shrink-0 rounded-md bg-purple-600 px-2 py-1 text-xs font-medium text-white hover:bg-purple-700"
                                    >
                                      Link
                                    </button>
                                  )}
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${issue.priority === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : issue.priority === "medium" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>{issue.priority}</span>
                                  {issue.department_name && <span className="text-xs text-gray-500 dark:text-gray-400">{issue.department_name}</span>}
                                </div>
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{issue.relevance_reason}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Resolution History */}
                    {suggestions.resolution_history && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-gray-400">Resolution History</p>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{suggestions.resolution_history.summary}</p>
                        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Based on {suggestions.resolution_history.past_count} similar resolved escalation{suggestions.resolution_history.past_count !== 1 ? "s" : ""}</p>
                      </div>
                    )}
                    {/* Empty state */}
                    {suggestions.matching_issues.length === 0 && !suggestions.resolution_history && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">No matching issues or resolution history found.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadSuggestions()}
                      className="w-full rounded-md border border-dashed px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Refresh
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="shrink-0 border-b px-4 py-3 dark:border-gray-800">
              <h2 className="font-semibold">Tool Calls</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Last 24 hours · older behind toggle</p>
            </div>
            <div className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto p-4 lg:max-h-none lg:min-h-0">
              {recentToolCalls.map((call) => (
                <ToolCallCard key={call.id} call={call} />
              ))}
              {selected && recentToolCalls.length === 0 && historicToolCalls.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">No tool calls for this conversation yet.</p>
              )}
              {selected && recentToolCalls.length === 0 && historicToolCalls.length > 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">No tool calls in the last 24 hours.</p>
              )}
              {historicToolCalls.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistoricToolCalls((v) => !v)}
                  className="w-full rounded-md border border-dashed px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {showHistoricToolCalls
                    ? "Hide historic tool calls"
                    : `Show ${historicToolCalls.length} historic tool call${historicToolCalls.length !== 1 ? "s" : ""}`}
                </button>
              )}
              {showHistoricToolCalls && historicToolCalls.map((call) => (
                <ToolCallCard key={call.id} call={call} />
              ))}
            </div>
          </aside>
        </div>
      </main>
      {showQuickEdit && <QuickEditModal onClose={() => setShowQuickEdit(false)} />}
    </>
  );
}

function ToolCallCard({ call }: { call: ToolCall }) {
  return (
    <div className="rounded-lg border bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{call.tool_name}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs ${call.allowed ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"}`}>
          {call.allowed ? "Allowed" : "Blocked"}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatDate(call.created_at)}</p>
      {call.result_summary && <p className="mt-2 break-words text-sm text-gray-600 dark:text-gray-300">{call.result_summary}</p>}
      <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">{stringify(call.arguments)}</pre>
    </div>
  );
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right font-medium text-gray-800 dark:text-gray-200">{value}</span>
    </div>
  );
}

// Right-rail registration profile. PII (age, phone, email, ITS) is already stripped
// server-side by /profile, so anything here is safe to show internal staff.
function ProfilePanel({ profile, loading }: { profile: ProfileResponse | null; loading: boolean }) {
  const hasDepartments = (profile?.departments?.length ?? 0) > 0;
  const p = profile?.profile;
  const hasProfile = !!p?.in_roster;

  // Nothing to show: not in roster and no committee departments.
  if (!loading && !hasProfile && !hasDepartments) return null;

  const m = p?.member ?? null;
  const f = p?.family ?? null;
  const accessibility = [m?.wheelchair ? "Wheelchair" : null, m?.rahat_seating ? "Rahat seating" : null]
    .filter(Boolean)
    .join(", ");
  const travelIn = m
    ? [m.arrival_at?.slice(0, 10), m.arrival_flight_no, m.airport].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="shrink-0 border-b px-4 py-3 dark:border-gray-800">
      <h2 className="font-semibold">User Profile</h2>
      {loading ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {hasProfile ? (
            <>
              {p?.registration_status && (
                <ProfileRow
                  label="Registration"
                  value={`${titleCase(p.registration_status)}${p.member_count > 1 ? ` · family of ${p.member_count}` : ""}`}
                />
              )}
              {m?.local_mehman && <ProfileRow label="Type" value={m.local_mehman} />}
              {(m?.city || m?.jamaat) && (
                <ProfileRow label="From" value={[m?.city, m?.jamaat].filter(Boolean).join(", ")} />
              )}
              {m?.not_attending && <ProfileRow label="Attending" value="Not attending" />}
              {f?.acc_type === "hotel" && (
                <ProfileRow label="Accommodation" value={`Hotel${f.hotel_name ? ` · ${f.hotel_name}` : ""}`} />
              )}
              {f?.acc_type === "utaro" && (
                <ProfileRow label="Accommodation" value={`Utaro${f.utaro_host_name ? ` · ${f.utaro_host_name}` : ""}`} />
              )}
              {f?.acc_type === "hotel" && f?.open_to_utaro && (
                <ProfileRow label="Utaro" value="Open to matching" />
              )}
              {f?.transport_mode && (
                <ProfileRow label="Transport" value={[f.transport_mode, f.transport_detail].filter(Boolean).join(" — ")} />
              )}
              {travelIn && <ProfileRow label="Arrival" value={travelIn} />}
              {m?.departure_at && <ProfileRow label="Departure" value={m.departure_at.slice(0, 10)} />}
              {accessibility && <ProfileRow label="Accessibility" value={accessibility} />}
              {m?.special_needs?.trim() && <ProfileRow label="Special needs" value={m.special_needs.trim()} />}
              {m?.wants_khidmat && <ProfileRow label="Khidmat" value="Interested" />}
            </>
          ) : (
            !hasDepartments && <p className="text-sm text-gray-500 dark:text-gray-400">No registration on file.</p>
          )}
          {hasDepartments && (
            <ProfileRow
              label="Departments"
              value={profile!.departments.map((d) => `${d.name} (${d.role})`).join(", ")}
            />
          )}
        </div>
      )}
    </div>
  );
}

function isImageMessage(m: Message): boolean {
  if (m.message_type === "image") return true;
  const raw = m.raw_payload as { kind?: string } | null;
  return raw?.kind === "image";
}

function reactionEmoji(m: Message): string | null {
  if (m.message_type !== "reaction") return null;
  if (m.body) return m.body;
  const raw = m.raw_payload as { message?: { reaction?: { emoji?: string } } } | null;
  return raw?.message?.reaction?.emoji ?? "👍";
}

// Renders a message bubble's content: a reaction emoji, an image (proxied from
// Meta), or plain text. The media route authenticates via the session cookie which
// the browser attaches to same-origin requests automatically.
function MessageContent({ message }: { message: Message }) {
  const emoji = reactionEmoji(message);
  if (emoji) {
    return <p className="text-sm">Reacted with {emoji}</p>;
  }

  if (isImageMessage(message)) {
    const src = `/api/admin/conversations/media/${message.id}`;
    const caption = message.body && message.body !== "[image]" ? message.body : null;
    return (
      <div>
        <a href={src} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Shared image" className="max-h-64 max-w-full rounded-md" />
        </a>
        {caption && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{caption}</p>}
      </div>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6">
      {message.body || `[${message.message_type || "message"}]`}
    </p>
  );
}

// ─── KPI Strip pill ──────────────────────────────────────────────────────────

function StatPill({ label, value, color, pulse }: { label: string; value: string | number; color?: "red" | "green" | "amber"; pulse?: boolean }) {
  const colorClasses = color === "red"
    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
    : color === "green"
    ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
    : color === "amber"
    ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
    : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300";

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${colorClasses} ${pulse ? "animate-pulse" : ""}`}>
      <span className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-lg font-bold">{value}</span>
    </div>
  );
}

// ─── SLA Countdown ───────────────────────────────────────────────────────────

function SLACountdown({ deadline }: { deadline: string }) {
  // Tick so the countdown stays live. Date.now() can't run during render (the React Compiler flags
  // it as impure), so it lives in state — lazy-seeded once, then refreshed on an interval.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const dl = new Date(deadline).getTime();
  const diff = dl - now;
  const minutes = Math.round(diff / 60000);
  const isBreaching = diff < 0;
  const isWarning = !isBreaching && minutes < 10;

  const label = isBreaching ? `${Math.abs(minutes)}m over` : `${minutes}m left`;
  const className = isBreaching
    ? "text-red-600 font-semibold dark:text-red-400"
    : isWarning
    ? "text-amber-600 font-semibold dark:text-amber-400"
    : "text-green-600 dark:text-green-400";

  return <span className={className}>{label}</span>;
}

// ─── Create Issue Panel ─────────────────────────────────────────────────────

type DeptOption = { id: string; name: string };
type DeptContact = { user_id?: string; name: string | null; dept_role?: string; role?: string; email?: string | null; phone?: string | null; phone_e164?: string | null };

function CreateIssuePanel({
  onSubmit,
  onCancel,
  onError,
}: {
  onSubmit: (fields: { title: string; description?: string; priority?: string; department_id?: string; assigned_to?: string }) => Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [departmentId, setDepartmentId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  // Departments list
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [deptContacts, setDeptContacts] = useState<DeptContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  // Fetch departments on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/departments");
        if (!res.ok) return;
        const data = await res.json().catch(() => []);
        setDepartments((Array.isArray(data) ? data : data.departments ?? []) as DeptOption[]);
      } catch { /* ignore */ }
    })();
  }, []);

  // Fetch contacts when department changes
  useEffect(() => {
    if (!departmentId) { setDeptContacts([]); setAssignedTo(""); return; }
    setContactsLoading(true);
    setAssignedTo("");
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/departments/${departmentId}/contacts`);
        if (!res.ok) { setDeptContacts([]); return; }
        const data = await res.json().catch(() => ({}));
        const contacts: DeptContact[] = [
          ...((data.member_contacts ?? []) as DeptContact[]),
          ...((data.reference_contacts ?? []) as DeptContact[]),
        ];
        setDeptContacts(contacts);
      } catch { setDeptContacts([]); }
      finally { setContactsLoading(false); }
    })();
  }, [departmentId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        department_id: departmentId || undefined,
        assigned_to: assignedTo || undefined,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setSaving(false);
    }
  }

  const priorities = [
    { value: "low" as const, label: "Low", color: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300" },
    { value: "medium" as const, label: "Medium", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    { value: "high" as const, label: "High", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Create New Issue</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          Cancel
        </button>
      </div>

      {/* Title */}
      <div>
        <label htmlFor="issue-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="issue-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Describe the issue…"
          autoFocus
          maxLength={500}
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="issue-desc" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Description
        </label>
        <textarea
          id="issue-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional details…"
          rows={3}
          maxLength={5000}
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      {/* Priority */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
        <div className="flex gap-2">
          {priorities.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPriority(p.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                priority === p.value
                  ? `${p.color} ring-2 ring-purple-500 ring-offset-1 dark:ring-offset-gray-900`
                  : "bg-gray-50 text-gray-400 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Department */}
      {departments.length > 0 && (
        <div>
          <label htmlFor="issue-dept" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Department
          </label>
          <select
            id="issue-dept"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Select department…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Department Contact */}
      {departmentId && (
        <div>
          <label htmlFor="issue-contact" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Assign to Contact
          </label>
          {contactsLoading ? (
            <p className="text-xs text-gray-400">Loading contacts…</p>
          ) : deptContacts.length === 0 ? (
            <p className="text-xs text-gray-400">No contacts for this department.</p>
          ) : (
            <select
              id="issue-contact"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">Unassigned</option>
              {deptContacts.map((c, i) => (
                <option key={c.user_id ?? `ref-${i}`} value={c.user_id ?? ""}>
                  {c.name ?? "Unnamed"}{c.dept_role ? ` (${c.dept_role})` : c.role ? ` (${c.role})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={!title.trim() || saving}
          className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Creating…" : "Create Issue"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Issue Detail Panel ──────────────────────────────────────────────────────

function IssueDetailPanel({
  detail,
  onNavigateToEscalation,
  onRefresh,
}: {
  detail: { issue: IssueDetail; escalations: IssueEscalation[]; activities: ActivityEntry[] };
  onNavigateToEscalation: (phone: string) => void;
  onRefresh: () => void;
}) {
  const { issue, escalations, activities } = detail;
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [deptContacts, setDeptContacts] = useState<DeptContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch department contacts when issue has a department.
  useEffect(() => {
    if (!issue.department_id) { setDeptContacts([]); return; }
    setContactsLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/departments/${issue.department_id}/contacts`);
        if (!res.ok) { setDeptContacts([]); return; }
        const data = await res.json().catch(() => ({}));
        const contacts: DeptContact[] = [
          ...((data.member_contacts ?? []) as DeptContact[]),
          ...((data.reference_contacts ?? []) as DeptContact[]),
        ];
        setDeptContacts(contacts);
      } catch { setDeptContacts([]); }
      finally { setContactsLoading(false); }
    })();
  }, [issue.department_id]);

  function copyToClipboard(text: string, id: string) {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold text-purple-600 dark:text-purple-400 font-mono">ISS-{issue.issue_number}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${issue.status === "resolved" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : issue.status === "in_progress" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
            {issue.status === "in_progress" ? "In Progress" : issue.status === "open" ? "Open" : "Resolved"}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${issue.priority === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : issue.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
            {issue.priority.toUpperCase()}
          </span>
        </div>
        <h2 className="text-lg font-semibold">{issue.title}</h2>
        {issue.description && <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{issue.description}</p>}
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
          {issue.department_name && <span>Dept: <strong className="text-gray-700 dark:text-gray-200">{issue.department_name}</strong></span>}
          {issue.assignee_name && <span>Assigned: <strong className="text-gray-700 dark:text-gray-200">{issue.assignee_name}</strong></span>}
          {issue.creator_name && <span>Created by <strong className="text-gray-700 dark:text-gray-200">{issue.creator_name}</strong> · {formatDate(issue.created_at)}</span>}
        </div>
      </div>

      {/* Actions */}
      {issue.status !== "resolved" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCloseModal(true)}
            className="rounded-md border border-green-500 px-3 py-1.5 text-sm font-medium text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
          >
            Close Issue
          </button>
        </div>
      )}

      {showCloseModal && (
        <CloseIssueModal
          issue={{ id: issue.id, issue_number: issue.issue_number, title: issue.title }}
          escalations={escalations}
          onComplete={() => { setShowCloseModal(false); onRefresh(); }}
          onCancel={() => setShowCloseModal(false)}
        />
      )}

      {/* Department Contacts */}
      {issue.department_id && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400 mb-2">
            {issue.department_name ?? "Department"} Contacts
          </h3>
          {contactsLoading ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">Loading contacts...</p>
          ) : deptContacts.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">No contacts configured for this department.</p>
          ) : (
            <div className="space-y-2">
              {deptContacts.map((c, i) => {
                const contactId = c.user_id ?? `ref-${i}`;
                const name = c.name ?? "Unknown";
                const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                const role = c.dept_role ?? c.role ?? null;
                const phone = c.phone ?? c.phone_e164 ?? null;
                const email = c.email ?? null;
                const avatarColor = role === "hod" ? "bg-purple-200 text-purple-700 dark:bg-purple-800 dark:text-purple-200" : role === "pm" ? "bg-blue-200 text-blue-700 dark:bg-blue-800 dark:text-blue-200" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
                const roleColor = role === "hod" ? "text-purple-600 dark:text-purple-400" : role === "pm" ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400";
                const copyText = [name, phone, email].filter(Boolean).join(" · ");

                return (
                  <div key={contactId} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor}`}>{initials}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{name}</span>
                        {role && <span className={`text-[10px] font-semibold uppercase ${roleColor}`}>{role}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {phone && (
                          <a href={`tel:${phone}`} className="hover:text-green-600 dark:hover:text-green-400">{phone}</a>
                        )}
                        {email && (
                          <a href={`mailto:${email}`} className="hover:text-blue-600 dark:hover:text-blue-400 truncate">{email}</a>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {phone && (
                        <>
                          <a href={`tel:${phone}`} title="Call" className="rounded-md p-1 hover:bg-green-50 dark:hover:bg-green-900/20">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-green-600 dark:text-green-400"><path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 012.43 8.326 13.019 13.019 0 012 5V3.5z" clipRule="evenodd" /></svg>
                          </a>
                          <a href={`https://wa.me/${phone.replace(/\+/g, "")}`} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="rounded-md p-1 hover:bg-green-50 dark:hover:bg-green-900/20">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-green-600 dark:text-green-400"><path fillRule="evenodd" d="M3.43 2.524A41.29 41.29 0 0110 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.102 41.102 0 01-3.55.414c-.28.02-.521.18-.643.413l-1.712 3.293a.75.75 0 01-1.33 0l-1.713-3.293a.75.75 0 00-.642-.413 41.108 41.108 0 01-3.55-.414C1.993 13.245 1 11.986 1 10.574V5.426c0-1.413.993-2.67 2.43-2.902z" clipRule="evenodd" /></svg>
                          </a>
                        </>
                      )}
                      {email && (
                        <a href={`mailto:${email}`} title="Email" className="rounded-md p-1 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-blue-600 dark:text-blue-400"><path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" /><path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" /></svg>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(copyText, contactId)}
                        title="Copy contact info"
                        className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {copiedId === contactId ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-green-600 dark:text-green-400"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-gray-400 dark:text-gray-500"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" /><path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Linked Escalations */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
          Linked Escalations <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{escalations.length}</span>
        </h3>
        {escalations.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No escalations linked to this issue yet.</p>
        ) : (
          <div className="space-y-1">
            {escalations.map((esc) => (
              <div
                key={esc.link_id}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 ${esc.breaching ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20" : "border-gray-200 dark:border-gray-700"}`}
              >
                <div className={`w-1 self-stretch rounded-full ${esc.breaching ? "bg-red-500" : esc.escalation_stage === "picked_up" ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{esc.display_name || esc.phone_e164}</span>
                    {esc.breaching && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">SLA BREACH</span>}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{esc.escalation_reason || esc.escalation_category || "—"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {esc.escalation_sla_deadline && <SLACountdown deadline={esc.escalation_sla_deadline} />}
                  <button
                    type="button"
                    onClick={() => onNavigateToEscalation(esc.phone_e164)}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 whitespace-nowrap"
                  >
                    View →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity Timeline */}
      {activities.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Activity</h3>
          <div className="space-y-2">
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-xs">
                <div className={`mt-1 w-2 h-2 shrink-0 rounded-full ${a.action.includes("resolved") ? "bg-green-500" : a.action.includes("linked") || a.action.includes("created") ? "bg-purple-500" : a.action.includes("picked") ? "bg-blue-500" : "bg-gray-400"}`} />
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{a.actor_label ?? "System"}</span>{" "}
                  <span className="text-gray-500 dark:text-gray-400">{a.action.replace(/_/g, " ")}</span>
                  <span className="ml-2 text-gray-400 dark:text-gray-500">{formatDate(a.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Issue Link Control ─────────────────────────────────────────────────────

function IssueLinkControl({
  conversation,
  issues,
  onLink,
  onUnlink,
  onCreate,
  onError,
  onNavigateToIssue,
}: {
  conversation: Conversation;
  issues: Issue[];
  onLink: (issueId: string) => Promise<void>;
  onUnlink: () => Promise<void>;
  onCreate: (fields: { title: string; description?: string; priority: string; department_id?: string; assigned_to?: string }) => Promise<void>;
  onError: (msg: string) => void;
  onNavigateToIssue?: (issueId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"link" | "create">("link");
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const [newDeptId, setNewDeptId] = useState("");
  const [newAssignedTo, setNewAssignedTo] = useState("");
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [deptContacts, setDeptContacts] = useState<DeptContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Fetch departments when modal opens
  useEffect(() => {
    if (!open || departments.length > 0) return;
    (async () => {
      try {
        const res = await apiFetch("/api/departments");
        if (!res.ok) return;
        const data = await res.json().catch(() => []);
        setDepartments((Array.isArray(data) ? data : data.departments ?? []) as DeptOption[]);
      } catch { /* ignore */ }
    })();
  }, [open, departments.length]);

  // Fetch contacts when department changes
  useEffect(() => {
    if (!newDeptId) { setDeptContacts([]); setNewAssignedTo(""); return; }
    setContactsLoading(true);
    setNewAssignedTo("");
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/departments/${newDeptId}/contacts`);
        if (!res.ok) { setDeptContacts([]); return; }
        const data = await res.json().catch(() => ({}));
        const contacts: DeptContact[] = [
          ...((data.member_contacts ?? []) as DeptContact[]),
          ...((data.reference_contacts ?? []) as DeptContact[]),
        ];
        setDeptContacts(contacts);
      } catch { setDeptContacts([]); }
      finally { setContactsLoading(false); }
    })();
  }, [newDeptId]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleEscape(e: KeyboardEvent) { if (e.key === "Escape") closeModal(); }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  function closeModal() { setOpen(false); setModalTab("link"); }

  function openModal() {
    setOpen(true);
    setModalTab("link");
    setSearch("");
    setNewTitle(conversation.escalation_reason ?? "");
    setNewDesc("");
    setNewPriority(conversation.escalation_priority === "urgent" ? "high" : "medium");
    setNewDeptId("");
    setNewAssignedTo("");
  }

  async function handleLink(issueId: string) {
    setSaving(true);
    try { await onLink(issueId); closeModal(); }
    catch (err) { onError(err instanceof Error ? err.message : "Failed to link issue"); }
    finally { setSaving(false); }
  }

  async function handleUnlink() {
    setSaving(true);
    try { await onUnlink(); }
    catch (err) { onError(err instanceof Error ? err.message : "Failed to unlink issue"); }
    finally { setSaving(false); }
  }

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await onCreate({
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        priority: newPriority,
        department_id: newDeptId || undefined,
        assigned_to: newAssignedTo || undefined,
      });
      closeModal();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create issue");
    } finally { setSaving(false); }
  }

  const isLinked = !!conversation.linked_issue_id;
  const filtered = issues.filter((i) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return i.title.toLowerCase().includes(q) || `iss-${i.issue_number}`.includes(q);
  });

  // ── Linked state ──
  if (isLinked) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onNavigateToIssue?.(conversation.linked_issue_id!)}
          className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700 transition-colors hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-800/60"
          title={conversation.linked_issue_title ?? `Issue #${conversation.linked_issue_number}`}
        >
          ISS-{conversation.linked_issue_number}
        </button>
        <button
          type="button"
          onClick={() => void handleUnlink()}
          disabled={saving}
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
          title="Unlink from issue"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
    );
  }

  // ── Unlinked state: trigger button + modal ──
  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/20"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Link Issue
      </button>

      {open && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === overlayRef.current) closeModal(); }}
        >
          <div className="relative mx-4 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" style={{ maxHeight: "85vh" }}>
            {/* Header with tabs */}
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4 dark:border-gray-700">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setModalTab("link")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${modalTab === "link" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"}`}
                >
                  Link Existing
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab("create")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${modalTab === "create" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"}`}
                >
                  Create New
                </button>
              </div>
              <button type="button" onClick={closeModal} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            {/* ── Link Existing tab ── */}
            {modalTab === "link" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="shrink-0 border-b px-6 py-4 dark:border-gray-700">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search open issues by title or ISS-number…"
                    autoFocus
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                  {/* Phase 2: AI-suggested matches will appear here */}
                </div>

                <div className="flex-1 overflow-y-auto" style={{ maxHeight: "50vh" }}>
                  {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-40"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                      <p className="text-sm">{search.trim() ? "No matching issues" : "No open issues"}</p>
                      <button
                        type="button"
                        onClick={() => { setModalTab("create"); setNewTitle(search.trim() || conversation.escalation_reason || ""); }}
                        className="mt-3 text-sm font-medium text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                      >
                        Create a new issue instead
                      </button>
                    </div>
                  ) : (
                    filtered.map((issue) => (
                      <button
                        key={issue.id}
                        type="button"
                        onClick={() => void handleLink(issue.id)}
                        disabled={saving}
                        className="flex w-full items-start gap-3 border-b border-gray-100 px-6 py-3.5 text-left transition-colors last:border-b-0 hover:bg-purple-50 disabled:opacity-50 dark:border-gray-800 dark:hover:bg-purple-900/20"
                      >
                        <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-purple-600 dark:text-purple-400">ISS-{issue.issue_number}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{issue.title}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${issue.priority === "high" ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" : issue.priority === "medium" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400" : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"}`}>
                              {issue.priority.toUpperCase()}
                            </span>
                            {issue.department_name && <span className="text-[10px] text-gray-400 dark:text-gray-500">{issue.department_name}</span>}
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">{issue.escalation_count} linked</span>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="shrink-0 border-t px-6 py-3 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => { setModalTab("create"); setNewTitle(search.trim() || conversation.escalation_reason || ""); }}
                    className="flex items-center gap-2 text-sm font-medium text-purple-600 transition-colors hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                    Create New Issue
                  </button>
                </div>
              </div>
            )}

            {/* ── Create New tab ── */}
            {modalTab === "create" && (
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="link-issue-title" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="link-issue-title"
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Describe the issue…"
                      autoFocus
                      maxLength={500}
                      className="w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="link-issue-desc" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Description
                    </label>
                    <textarea
                      id="link-issue-desc"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="Additional context, steps to reproduce, expected behavior…"
                      rows={4}
                      maxLength={5000}
                      className="w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Priority</label>
                      <div className="flex gap-1.5">
                        {(["low", "medium", "high"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setNewPriority(p)}
                            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                              newPriority === p
                                ? p === "high" ? "bg-red-500 text-white shadow-sm" : p === "medium" ? "bg-amber-500 text-white shadow-sm" : "bg-gray-500 text-white shadow-sm"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
                            }`}
                          >
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {departments.length > 0 && (
                      <div>
                        <label htmlFor="link-issue-dept" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Department</label>
                        <select
                          id="link-issue-dept"
                          value={newDeptId}
                          onChange={(e) => setNewDeptId(e.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        >
                          <option value="">Select department…</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {newDeptId && (
                    <div>
                      <label htmlFor="link-issue-contact" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Assign to Contact</label>
                      {contactsLoading ? (
                        <p className="py-1 text-xs text-gray-400">Loading contacts…</p>
                      ) : deptContacts.length === 0 ? (
                        <p className="py-1 text-xs text-gray-400">No contacts for this department.</p>
                      ) : (
                        <select
                          id="link-issue-contact"
                          value={newAssignedTo}
                          onChange={(e) => setNewAssignedTo(e.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        >
                          <option value="">Unassigned</option>
                          {deptContacts.map((c, i) => (
                            <option key={c.user_id ?? `ref-${i}`} value={c.user_id ?? ""}>
                              {c.name ?? "Unnamed"}{c.dept_role ? ` (${c.dept_role})` : c.role ? ` (${c.role})` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={!newTitle.trim() || saving}
                    className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-purple-700 disabled:opacity-50"
                  >
                    {saving ? "Creating…" : "Create & Link"}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function stringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
