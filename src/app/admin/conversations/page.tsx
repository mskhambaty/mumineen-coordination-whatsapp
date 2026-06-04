"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { canAccessInbox, isAdminOrLeadership } from "@/lib/admin/access";
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
  last_message_at: string;
  last_message: Message | null;
  unread_inbound_count: number;
  messages: Message[];
  tool_calls: ToolCall[];
  quality_score: "good" | "poor" | null;
  quality_reason: string | null;
  quality_analyzed_at: string | null;
};

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
  const [tab, setTab] = useState<"conversations" | "escalations">(
    () => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "escalations" ? "escalations" : "conversations"),
  );
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [qualityFilter, setQualityFilter] = useState<"all" | "poor">("all");
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagePaneRef = useRef<HTMLDivElement>(null);
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [canQuickEdit] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return isAdminOrLeadership(JSON.parse(window.localStorage.getItem("admin_user") ?? "null"));
    } catch {
      return false;
    }
  });

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  const escalatedCount = useMemo(
    () => conversations.filter((conversation) => conversation.escalation_status === "pending").length,
    [conversations],
  );

  // Escalated threads live in the Escalations tab (urgent first); everything else
  // stays in Conversations.
  const visibleConversations = useMemo(() => {
    const inEscalations = (c: Conversation) => c.escalation_status === "pending";
    const list = conversations.filter((c) => (tab === "escalations" ? inEscalations(c) : !inEscalations(c)));
    if (tab === "escalations") {
      return [...list].sort((a, b) => {
        if (a.escalation_priority !== b.escalation_priority) {
          return a.escalation_priority === "urgent" ? -1 : 1;
        }
        return b.last_message_at.localeCompare(a.last_message_at);
      });
    }
    return list;
  }, [conversations, tab]);

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

  useEffect(() => {
    const pane = messagePaneRef.current;
    if (!pane) return;

    const frame = requestAnimationFrame(() => {
      pane.scrollTop = pane.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [selected?.phone_e164, latestMessageId]);

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      const here = window.location.pathname + window.location.search;
      router.push(`/admin/login?redirect=${encodeURIComponent(here)}`);
      return;
    }

    const userRaw = localStorage.getItem("admin_user");
    const user = userRaw ? JSON.parse(userRaw) as { role?: string; global_role?: string; is_support?: boolean } : null;
    if (!canAccessInbox(user)) {
      router.push("/admin/tasks");
      return;
    }

    void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Live updates via Server-Sent Events: the server pushes a "changed" event when
  // conversation activity changes, instead of the browser polling on a timer.
  useEffect(() => {
    if (!adminKey) return;
    const source = new EventSource(`/api/admin/conversations/stream?key=${encodeURIComponent(adminKey)}`);
    // Refetch on every (re)connect to catch anything missed during a reconnect gap.
    source.onopen = () => void refreshConversationsSilently();
    source.addEventListener("changed", () => void refreshConversationsSilently());
    // EventSource reconnects automatically on error/close; just clean up on unmount.
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  // Backstop: refetch when the tab regains focus.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refreshConversationsSilently();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apiFetch(path: string, init?: RequestInit) {
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
        ...(init?.headers ?? {}),
      },
    });
  }

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

  async function setMode(mode: HandlingMode) {
    if (!selected || selected.handling_mode === mode) return;
    setSavingMode(true);
    setError(null);
    try {
      const userRaw = localStorage.getItem("admin_user");
      const user = userRaw ? JSON.parse(userRaw) as { id?: string } : {};
      const res = await apiFetch(`/api/admin/conversations/${encodeURIComponent(selected.phone_e164)}/mode`, {
        method: "PUT",
        body: JSON.stringify({ mode, user_id: user.id }),
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

  async function setEscalation(status: "pending" | "resolved") {
    if (!selected) return;
    setSavingEscalation(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/conversations/${encodeURIComponent(selected.phone_e164)}/escalation`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update escalation");
      }
      const phone = selected.phone_e164;
      setConversations((items) =>
        items.map((item) =>
          item.phone_e164 === phone ? { ...item, escalation_status: status } : item,
        ),
      );
      // Keep the thread in view: escalated threads live in the Escalations tab.
      setSelectedPhone(phone);
      setTab(status === "pending" ? "escalations" : "conversations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update escalation");
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
        res = await fetch(path, { method: "POST", headers: { "x-admin-key": adminKey }, body: form });
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

  const isManual = selected?.handling_mode === "manual";

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}

        <div className="grid min-h-[600px] grid-cols-1 overflow-hidden rounded-lg border bg-white shadow-sm lg:h-[calc(100vh-7rem)] lg:min-h-[520px] lg:grid-cols-[320px_minmax(0,1fr)_320px] dark:border-gray-800 dark:bg-gray-900">
          <aside className="flex flex-col border-b bg-gray-50 lg:h-full lg:min-h-0 lg:border-b-0 lg:border-r dark:border-gray-800 dark:bg-gray-900/40">
            <div className="shrink-0 border-b px-4 py-3 dark:border-gray-800">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex gap-1 text-sm font-medium">
                  <button
                    onClick={() => setTab("conversations")}
                    className={`rounded-md px-2 py-1 ${tab === "conversations" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
                  >
                    Conversations
                  </button>
                  <button
                    onClick={() => setTab("escalations")}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 ${tab === "escalations" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
                  >
                    Escalations
                    {escalatedCount > 0 && (
                      <span className="rounded-full bg-amber-500 px-1.5 text-xs text-white">{escalatedCount}</span>
                    )}
                  </button>
                </div>
                <button onClick={() => void loadConversations()} className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">Refresh</button>
              </div>
              <div className="relative">
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
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={qualityFilter === "poor"}
                  onChange={(e) => setQualityFilter(e.target.checked ? "poor" : "all")}
                />
                Show only needs-review
              </label>
            </div>
            <div className="max-h-[60vh] flex-1 overflow-y-auto lg:max-h-none lg:min-h-0">
              {loading ? (
                <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
              ) : searchedConversations.length === 0 ? (
                <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
                  {search.trim()
                    ? "No chats match your search."
                    : tab === "escalations" ? "No escalations." : "No conversations yet."}
                </p>
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
                        <span>{formatDate(conversation.last_message_at)}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">{conversation.messages.length} msg{conversation.messages.length !== 1 ? "s" : ""}</span>
                      </div>
                      {conversation.unread_inbound_count > 0 && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/40 dark:text-green-300">{conversation.unread_inbound_count} new</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="flex min-h-[600px] flex-col lg:h-full lg:min-h-0">
            <div className="shrink-0 border-b px-5 py-4 dark:border-gray-800">
              {selected ? (
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{selected.display_name || selected.phone_e164}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{selected.phone_e164}{selected.email ? ` · ${selected.email}` : ""}</p>
                    {selected.escalation_status === "pending" && (
                      <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        Escalated{selected.escalation_category ? ` · #${selected.escalation_category}` : ""}{selected.escalation_priority === "urgent" ? " · URGENT" : ""}
                        {selected.escalation_reason ? ` — ${selected.escalation_reason}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
                    <button
                      type="button"
                      onClick={() => void shareChatLink()}
                      title="Copy a shareable link to this chat"
                      className="whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {linkCopied ? "Link copied!" : "Share"}
                    </button>
                    {selected.escalation_status === "pending" ? (
                      <button
                        type="button"
                        onClick={() => void setEscalation("resolved")}
                        disabled={savingEscalation}
                        className="whitespace-nowrap rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        {savingEscalation ? "Saving…" : "De-escalate"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setEscalation("pending")}
                        disabled={savingEscalation}
                        className="whitespace-nowrap rounded-md border border-amber-500 px-3 py-1.5 text-sm font-medium text-amber-600 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                      >
                        {savingEscalation ? "Saving…" : "Escalate"}
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${!isManual ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-gray-500"}`}>Agent</span>
                    <button
                      type="button"
                      onClick={() => void setMode(isManual ? "ai" : "manual")}
                      disabled={savingMode}
                      role="switch"
                      aria-checked={isManual}
                      className={`relative inline-flex h-7 w-14 shrink-0 items-center rounded-full transition-colors ${isManual ? "bg-amber-500" : "bg-blue-600"} disabled:opacity-50`}
                      aria-label="Toggle manual mode"
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${isManual ? "translate-x-8" : "translate-x-1"}`} />
                    </button>
                    <span className={`text-sm font-medium ${isManual ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-gray-500"}`}>Manual</span>
                    </div>
                  </div>
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
                      <MessageContent message={message} adminKey={adminKey} />
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
            <div className="shrink-0 border-b px-4 py-3 dark:border-gray-800">
              <h2 className="font-semibold">Tool Calls</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Agent actions for this thread</p>
            </div>
            <div className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto p-4 lg:max-h-none lg:min-h-0">
              {selected?.tool_calls.map((call) => (
                <div key={call.id} className="rounded-lg border bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
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
              ))}
              {selected && selected.tool_calls.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No tool calls for this conversation yet.</p>}
            </div>
          </aside>
        </div>
      </main>
      {showQuickEdit && <QuickEditModal adminKey={adminKey} onClose={() => setShowQuickEdit(false)} />}
    </>
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
// Meta), or plain text.
function MessageContent({ message, adminKey }: { message: Message; adminKey: string }) {
  const emoji = reactionEmoji(message);
  if (emoji) {
    return <p className="text-sm">Reacted with {emoji}</p>;
  }

  if (isImageMessage(message)) {
    const src = `/api/admin/conversations/media/${message.id}?key=${encodeURIComponent(adminKey)}`;
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
