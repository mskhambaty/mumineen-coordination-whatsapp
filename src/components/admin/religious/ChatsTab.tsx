"use client";

import { useState } from "react";

import { apiFetch } from "@/lib/admin/client";
import { Badge, Conversation, Empty, HandlingMode, MessageBubble, ModeToggle, fmt } from "./ui";

// The Inbox, scoped to religious chats: list │ thread + AI/Manual toggle + reply. The toggle flips
// conversation_sessions.handling_mode (shared with the agent); the reply is allowed only in Manual +
// inside WhatsApp's 24h window (mirrors the general Inbox).
export default function ChatsTab({ conversations, onReload }: { conversations: Conversation[]; onReload: () => Promise<void> | void }) {
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [inWindowOnly, setInWindowOnly] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const list = conversations.filter((c) => {
    if (inWindowOnly && !c.in_window) return false;
    if (!q) return true;
    return (
      (c.name ?? "").toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.messages.some((m) => m.body.toLowerCase().includes(q))
    );
  });
  const active = conversations.find((c) => c.phone === activePhone) ?? null;
  const canReply = !!active && active.handling_mode === "manual" && active.in_window;

  async function setMode(mode: HandlingMode) {
    if (!active || active.handling_mode === mode) return;
    setSavingMode(true);
    setNotice(null);
    try {
      const res = await apiFetch("/api/admin/religious/mode", { method: "PUT", body: JSON.stringify({ phone: active.phone, mode }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to switch mode");
      await onReload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to switch mode");
    } finally {
      setSavingMode(false);
    }
  }

  async function sendReply() {
    if (!active || !reply.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await apiFetch("/api/admin/religious/reply", { method: "POST", body: JSON.stringify({ phone: active.phone, text: reply.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setReply("");
      setNotice("Reply sent.");
      await onReload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      {/* List */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="space-y-2 border-b border-gray-100 p-3 dark:border-gray-800">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, number, message…"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          />
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <input type="checkbox" checked={inWindowOnly} onChange={(e) => setInWindowOnly(e.target.checked)} />
            In-window only
          </label>
        </div>
        <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
          {list.map((c) => {
            const last = c.messages[c.messages.length - 1];
            return (
              <li key={c.phone}>
                <button
                  onClick={() => { setActivePhone(c.phone); setNotice(null); setReply(""); }}
                  className={`block w-full border-l-4 px-3 py-2.5 text-left ${
                    activePhone === c.phone ? "border-l-blue-600 bg-blue-50 dark:border-l-blue-400 dark:bg-blue-900/20" : "border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-gray-900 dark:text-gray-100">{c.name ?? `…${c.phone_last4}`}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className={`h-2 w-2 rounded-full ${c.in_window ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`} title={c.in_window ? "In 24h window" : "Window closed"} />
                      <Badge tone={c.handling_mode === "manual" ? "amber" : "blue"}>{c.handling_mode.toUpperCase()}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">{last?.body ?? ""}</p>
                  <p className="mt-0.5 text-[11px] text-gray-400">{fmt(c.last_at)}</p>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">No chats.</li>}
        </ul>
      </div>

      {/* Thread */}
      <div className="flex min-h-[32rem] flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">Select a conversation</div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{active.name ?? `…${active.phone_last4}`}</div>
                <div className="text-xs text-gray-400">{active.in_window ? "Inside 24h window" : "Outside 24h window"}</div>
              </div>
              <ModeToggle mode={active.handling_mode} onChange={setMode} disabled={savingMode} />
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50/50 p-4 dark:bg-gray-950/30">
              {active.messages.map((m, i) => (
                <MessageBubble key={i} direction={m.direction} body={m.body} at={m.created_at} />
              ))}
            </div>

            <div className="border-t border-gray-100 p-3 dark:border-gray-800">
              {canReply ? (
                <div className="flex gap-2">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendReply(); } }}
                    placeholder="Reply to this member…"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  />
                  <button onClick={sendReply} disabled={sending || !reply.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700">
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              ) : active.handling_mode !== "manual" ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">Switch to <strong>Manual</strong> to reply yourself — otherwise the AI keeps handling this chat.</p>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">This member is outside WhatsApp&apos;s 24-hour window — a free-text reply can&apos;t be delivered. Use an approved template.</p>
              )}
              {notice && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{notice}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
