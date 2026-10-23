"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

// In-app agent chat: the signed-in user talks to the AI agent as themselves — the same single,
// persistent conversation a WhatsApp thread was. Inbox users see it (tagged "In-app chat") and can
// escalate, take over, and reply exactly as before. See docs/ai-agent.md#in-app-agent-chat.

type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  from: "you" | "agent" | "team";
  body: string;
  created_at: string;
};

const POLL_WAITING_MS = 2500; // while an agent reply is expected
const POLL_IDLE_MS = 8000; // otherwise (a team member may still reply)
const TYPING_WINDOW_MS = 3 * 60 * 1000; // stop showing "typing" if no reply arrives by then
const VISITOR_MODE_KEY = "agent_chat_visitor_mode";

function readVisitorMode(): boolean {
  try {
    return window.localStorage.getItem(VISITOR_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeVisitorMode(on: boolean) {
  try {
    window.localStorage.setItem(VISITOR_MODE_KEY, on ? "1" : "0");
  } catch {
    // per-viewer convenience only
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function AgentChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [handlingMode, setHandlingMode] = useState<string>("ai");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visitorMode, setVisitorMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  const merge = useCallback((incoming: ChatMessage[]) => {
    const byId = new Map(messagesRef.current.map((m) => [m.id, m]));
    for (const m of incoming) byId.set(m.id, m);
    const next = [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const fetchThread = useCallback(async () => {
    const last = messagesRef.current.at(-1)?.created_at;
    const res = await apiFetch(`/api/agent-chat${last ? `?after=${encodeURIComponent(last)}` : ""}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Failed to load the conversation");
    merge((data.messages as ChatMessage[]) ?? []);
    setHandlingMode((data.handling_mode as string) ?? "ai");
  }, [merge]);

  useEffect(() => {
    const user = readAdminUser();
    if (!user) { router.push("/admin/login"); return; }
    if (!canAccessPortal(user)) { router.push("/admin/conversations"); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisitorMode(readVisitorMode());
    fetchThread().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load the conversation");
      setMessages([]);
    });
  }, [router, fetchThread]);

  // Clock for the "typing" window, advanced on each poll tick (keeps render pure).
  const [now, setNow] = useState(() => Date.now());
  const lastMessage = messages?.at(-1);
  const awaitingReply =
    handlingMode !== "manual" &&
    lastMessage?.from === "you" &&
    now - new Date(lastMessage.created_at).getTime() < TYPING_WINDOW_MS;

  // Poll for the agent's reply (it's generated a few seconds after send) and for team replies.
  useEffect(() => {
    if (messages === null) return;
    const id = window.setTimeout(() => {
      setNow(Date.now());
      fetchThread().catch(() => undefined);
    }, awaitingReply ? POLL_WAITING_MS : POLL_IDLE_MS);
    return () => window.clearTimeout(id);
  }, [messages, awaitingReply, fetchThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, awaitingReply]);

  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch("/api/agent-chat", {
        method: "POST",
        body: JSON.stringify({ text, visitor_mode: visitorMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setDraft("");
      setNow(Date.now());
      await fetchThread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  function toggleVisitorMode() {
    setVisitorMode((on) => {
      writeVisitorMode(!on);
      return !on;
    });
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col px-4 py-6 sm:px-6 lg:h-[calc(100vh-4rem)] lg:px-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Chat with Agent</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Talk to the AI agent the way members did on WhatsApp. This is your own conversation. Escalations are real and go to the on-call team.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm" title="Chat as a regular member: hides committee tools like tasks">
          <span className="font-medium">Visitor mode</span>
          <button
            type="button"
            role="switch"
            aria-checked={visitorMode}
            onClick={toggleVisitorMode}
            className={`relative h-6 w-11 rounded-full transition ${visitorMode ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-700"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${visitorMode ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </label>
      </div>

      <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-lg border bg-white shadow-sm lg:min-h-0 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
          {messages === null && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
          {messages?.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No messages yet. Say salaam to start the conversation.</p>
          )}
          {messages?.map((message) => {
            const mine = message.from === "you";
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[78%] rounded-lg border px-4 py-3 shadow-sm ${
                  mine
                    ? "bg-blue-600 text-white dark:bg-blue-700"
                    : message.from === "team"
                      ? "border-amber-200 bg-amber-50 text-gray-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-gray-100"
                      : "bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                }`}>
                  {!mine && (
                    <p className="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {message.from === "team" ? "Team member" : "Agent"}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                  <p className={`mt-2 text-xs ${mine ? "text-blue-100" : "text-gray-400 dark:text-gray-500"}`}>{formatTime(message.created_at)}</p>
                </div>
              </div>
            );
          })}
          {awaitingReply && (
            <div className="flex justify-start">
              <div className="rounded-lg border bg-white px-4 py-3 text-sm text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                Agent is typing…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={send} className="shrink-0 border-t bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          {handlingMode === "manual" && (
            <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">A team member has taken over this chat. They will reply here.</p>
          )}
          {visitorMode && (
            <p className="mb-2 text-xs text-blue-700 dark:text-blue-400">Visitor mode is on: the agent treats you as a regular member.</p>
          )}
          {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={4096}
              disabled={sending || messages === null}
              placeholder="Type a message (text only)"
              className="min-h-[56px] flex-1 resize-none rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800/50"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending || messages === null}
              className="w-24 rounded-md bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {sending ? "Sending" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
