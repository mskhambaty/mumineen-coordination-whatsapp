"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { canAccessInbox } from "@/lib/admin/access";

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

  const selected = useMemo(
    () => visibleConversations.find((conversation) => conversation.phone_e164 === selectedPhone) ?? visibleConversations[0] ?? null,
    [visibleConversations, selectedPhone],
  );

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
    if (!selected || !reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/conversations/${encodeURIComponent(selected.phone_e164)}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to send reply");
      }
      setReply("");
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  const isManual = selected?.handling_mode === "manual";

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}

        <div className="grid min-h-[720px] grid-cols-1 overflow-hidden rounded-lg border bg-white shadow-sm lg:h-[720px] lg:grid-cols-[320px_minmax(0,1fr)_320px] dark:border-gray-800 dark:bg-gray-900">
          <aside className="border-b bg-gray-50 lg:border-b-0 lg:border-r dark:border-gray-800 dark:bg-gray-900/40">
            <div className="border-b px-4 py-3 dark:border-gray-800">
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
            </div>
            <div className="max-h-[668px] overflow-y-auto">
              {loading ? (
                <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
              ) : visibleConversations.length === 0 ? (
                <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
                  {tab === "escalations" ? "No escalations." : "No conversations yet."}
                </p>
              ) : (
                visibleConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedPhone(conversation.phone_e164)}
                    className={`block w-full border-b border-l-4 px-4 py-3 text-left dark:border-gray-800 ${
                      selected?.phone_e164 === conversation.phone_e164
                        ? "border-l-blue-600 bg-blue-50 dark:border-l-blue-400 dark:bg-gray-800"
                        : "border-l-transparent hover:bg-gray-100 dark:hover:bg-gray-800/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{conversation.display_name || conversation.phone_e164}</p>
                      <div className="flex shrink-0 items-center gap-1">
                        {conversation.escalation_status === "pending" && (
                          <span className={`rounded-full px-2 py-0.5 text-xs ${conversation.escalation_priority === "urgent" ? "bg-red-500 text-white" : "bg-amber-500 text-white"}`}>
                            {conversation.escalation_priority === "urgent" ? "URGENT" : "ESCALATED"}
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs ${conversation.handling_mode === "manual" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>
                          {conversation.handling_mode.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    {conversation.escalation_status === "pending" && conversation.escalation_category && (
                      <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">#{conversation.escalation_category}</p>
                    )}
                    <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">{conversation.last_message?.body || "No message body"}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                      <span>{formatDate(conversation.last_message_at)}</span>
                      {conversation.unread_inbound_count > 0 && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/40 dark:text-green-300">{conversation.unread_inbound_count} new</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="flex min-h-[720px] flex-col">
            <div className="border-b px-5 py-4 dark:border-gray-800">
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

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 p-5 dark:bg-gray-950/40">
              {selected?.messages.map((message) => (
                <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] rounded-lg border px-4 py-3 shadow-sm ${message.direction === "outbound" ? "bg-blue-600 text-white dark:bg-blue-700" : "bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"}`}>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body || `[${message.message_type || "message"}]`}</p>
                    <p className={`mt-2 text-xs ${message.direction === "outbound" ? "text-blue-100" : "text-gray-400 dark:text-gray-500"}`}>{formatDate(message.created_at)}</p>
                  </div>
                </div>
              ))}
              {selected && selected.messages.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No messages stored for this conversation.</p>}
            </div>

            <form onSubmit={sendReply} className="border-t bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Manual WhatsApp Reply</p>
                {selected?.handling_mode !== "manual" && <p className="text-xs text-amber-700 dark:text-amber-400">Switch to Manual before replying.</p>}
              </div>
              <div className="flex gap-2">
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={2}
                  disabled={!selected || selected.handling_mode !== "manual" || sending}
                  placeholder="Type a WhatsApp reply"
                  className="min-h-[56px] flex-1 resize-none rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800/50"
                />
                <button
                  type="submit"
                  disabled={!selected || selected.handling_mode !== "manual" || !reply.trim() || sending}
                  className="w-24 rounded-md bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                >
                  {sending ? "Sending" : "Send"}
                </button>
              </div>
            </form>
          </section>

          <aside className="border-t bg-white lg:border-l lg:border-t-0 dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b px-4 py-3 dark:border-gray-800">
              <h2 className="font-semibold">Tool Calls</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Agent actions for this thread</p>
            </div>
            <div className="max-h-[668px] space-y-3 overflow-y-auto p-4">
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
