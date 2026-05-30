"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";

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
  last_message_at: string;
  last_message: Message | null;
  unread_inbound_count: number;
  messages: Message[];
  tool_calls: ToolCall[];
};

export default function ConversationsPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.phone_e164 === selectedPhone) ?? conversations[0] ?? null,
    [conversations, selectedPhone],
  );

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    const userRaw = localStorage.getItem("admin_user");
    const user = userRaw ? JSON.parse(userRaw) as { role?: string; global_role?: string } : null;
    if (!isAdminOrLeadership(user)) {
      router.push("/admin/tasks");
      return;
    }

    void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Poll for new messages so the inbox stays live without manual refresh.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshConversationsSilently();
      }
    }, 8000);
    return () => clearInterval(interval);
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

        <div className="grid min-h-[720px] grid-cols-1 overflow-hidden rounded-lg border bg-white shadow-sm lg:grid-cols-[320px_minmax(0,1fr)_320px] dark:border-gray-800 dark:bg-gray-900">
          <aside className="border-b bg-gray-50 lg:border-b-0 lg:border-r dark:border-gray-800 dark:bg-gray-900/40">
            <div className="border-b px-4 py-3 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Conversations</h2>
                <button onClick={() => void loadConversations()} className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">Refresh</button>
              </div>
            </div>
            <div className="max-h-[668px] overflow-y-auto">
              {loading ? (
                <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
              ) : conversations.length === 0 ? (
                <p className="p-4 text-sm text-gray-500 dark:text-gray-400">No conversations yet.</p>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedPhone(conversation.phone_e164)}
                    className={`block w-full border-b px-4 py-3 text-left hover:bg-white dark:border-gray-800 dark:hover:bg-gray-800 ${
                      selected?.phone_e164 === conversation.phone_e164 ? "bg-white dark:bg-gray-800" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{conversation.display_name || conversation.phone_e164}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${conversation.handling_mode === "manual" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>
                        {conversation.handling_mode.toUpperCase()}
                      </span>
                    </div>
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
                  </div>
                  <div className="flex items-center gap-3">
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
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">Select a conversation.</p>
              )}
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-5 dark:bg-gray-950/40">
              {selected?.messages.map((message) => (
                <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] rounded-lg border px-4 py-3 shadow-sm ${message.direction === "outbound" ? "bg-blue-600 text-white dark:bg-blue-700" : "bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"}`}>
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.body || `[${message.message_type || "message"}]`}</p>
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
