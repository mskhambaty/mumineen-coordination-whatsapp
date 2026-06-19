"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/admin/client";
import { Badge, Conversation, HandlingMode, MessageBubble, ModeToggle, fmt } from "./ui";

const POLL_MS = 5000;

// Religious-scoped Inbox — a self-contained clone of the inbox's conversation surface, but only the
// chats that used a religious / Lisan tool (the endpoint is server-scoped, so no logistics PII).
// Stays LIVE by polling every 5s while visible + refetching on tab focus (religious monitors can't
// use the inbox's SSE stream, which is canAccessInbox-gated). Mobile is WhatsApp-style master/detail:
// list → tap a chat → thread opens full-screen with a ← back button. Desktop is two-pane.
export default function ReligiousInbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Lookback: show religious chats whose religious tool-call landed within this window (default 48h).
  const [windowHours, setWindowHours] = useState(48);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Optimistically-shown sent messages per phone, so a reply appears instantly; cleared once a poll
  // brings back the real outbound (deduped by body so there's never a doubled bubble).
  const [pendingSent, setPendingSent] = useState<Record<string, { body: string; created_at: string }[]>>({});

  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return; // don't stack overlapping polls
    inFlight.current = true;
    try {
      // Cache-bust (`?t=`) + `no-store`: every poll must be a UNIQUE, uncacheable request so the
      // browser / any edge cache can't replay a stale copy — the real cause of the old staleness
      // (force-dynamic alone only kept the SERVER fresh; the client was serving a cached response).
      const res = await apiFetch(`/api/admin/religious/conversations?windowHours=${windowHours}&t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) setConversations(((await res.json()).conversations ?? []) as Conversation[]);
    } catch {
      // Silent — a transient poll failure must not disrupt the open thread.
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [windowHours]);

  // Initial load + live refresh: poll while the tab is visible, and refetch immediately on focus.
  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(() => void load(), POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => {
      if (document.visibilityState === "visible") { void load(); start(); } else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const q = search.trim().toLowerCase();
  const list = conversations.filter((c) => {
    if (!q) return true;
    return (
      (c.name ?? "").toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.messages.some((m) => m.body.toLowerCase().includes(q))
    );
  });
  const active = conversations.find((c) => c.phone === activePhone) ?? null;
  const canReply = !!active && active.handling_mode === "manual" && active.in_window;

  // Thread = the fetched messages + any optimistic sends a poll hasn't reflected yet (dedup by body).
  const threadMessages = (() => {
    if (!active) return [];
    const seen = new Set(active.messages.map((m) => `${m.direction}:${m.body}`));
    const extra = (pendingSent[active.phone] ?? [])
      .filter((m) => !seen.has(`outbound:${m.body}`))
      .map((m) => ({ direction: "outbound" as const, body: m.body, created_at: m.created_at }));
    return [...active.messages, ...extra];
  })();

  // Auto-scroll to the newest message when a conversation opens or a message arrives.
  const messagePaneRef = useRef<HTMLDivElement>(null);
  const lastAt = threadMessages[threadMessages.length - 1]?.created_at;
  useEffect(() => {
    const pane = messagePaneRef.current;
    if (!pane) return;
    const frame = requestAnimationFrame(() => { pane.scrollTop = pane.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [activePhone, lastAt]);

  async function setMode(mode: HandlingMode) {
    if (!active || active.handling_mode === mode) return;
    setSavingMode(true);
    setNotice(null);
    try {
      const res = await apiFetch("/api/admin/religious/mode", { method: "PUT", body: JSON.stringify({ phone: active.phone, mode }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to switch mode");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to switch mode");
    } finally {
      setSavingMode(false);
    }
  }

  async function sendReply() {
    if (!active || !reply.trim()) return;
    const phone = active.phone;
    const text = reply.trim();
    setSending(true);
    setNotice(null);
    try {
      const res = await apiFetch("/api/admin/religious/reply", { method: "POST", body: JSON.stringify({ phone, text }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setReply("");
      setNotice("Reply sent.");
      setPendingSent((p) => ({ ...p, [phone]: [...(p[phone] ?? []), { body: text, created_at: new Date().toISOString() }] }));
      setSending(false);
      await load();
      setPendingSent((p) => {
        if (!p[phone]) return p;
        const next = { ...p };
        delete next[phone];
        return next;
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Send failed");
      setSending(false);
    }
  }

  return (
    <div className="grid h-[calc(100dvh-12rem)] min-h-[28rem] gap-4 md:h-[calc(100vh-21rem)] md:min-h-[34rem] md:grid-cols-[300px_1fr]">
      {/* List — full-screen on mobile until a chat is opened (master/detail) */}
      <div className={`min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white md:flex dark:border-gray-800 dark:bg-gray-900 ${active ? "hidden" : "flex"}`}>
        <div className="space-y-2 border-b border-gray-100 p-3 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, number, message…"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={() => void load()}
              title="Refresh"
              aria-label="Refresh conversations"
              className="shrink-0 rounded-md border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M10 3a7 7 0 105.66 2.86l1.42-1.42A1 1 0 0018 5V1h-4a1 1 0 00-.71 1.71l1.13 1.13A5 5 0 1115 10h2a7 7 0 00-7-7z"/></svg>
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <span>Active in</span>
            <select
              value={windowHours}
              onChange={(e) => setWindowHours(Number(e.target.value))}
              className="rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            >
              <option value={24}>last 24h</option>
              <option value={48}>last 48h</option>
              <option value={168}>last 7 days</option>
            </select>
          </label>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
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
          {list.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">{loaded ? "No chats." : "Loading…"}</li>
          )}
        </ul>
      </div>

      {/* Thread — full-screen on mobile when a chat is open, with a Back button */}
      <div className={`min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white md:flex dark:border-gray-800 dark:bg-gray-900 ${active ? "flex" : "hidden"}`}>
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">Select a conversation</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setActivePhone(null); setNotice(null); }}
                  className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 md:hidden dark:text-gray-400 dark:hover:bg-gray-800"
                  aria-label="Back to conversations"
                >
                  ←
                </button>
                <div className="min-w-0">
                  <div className="truncate font-medium text-gray-900 dark:text-gray-100">{active.name ?? `…${active.phone_last4}`}</div>
                  <div className="text-xs text-gray-400">{active.in_window ? "Inside 24h window" : "Outside 24h window"}</div>
                </div>
              </div>
              <ModeToggle mode={active.handling_mode} onChange={setMode} disabled={savingMode} />
            </div>

            <div ref={messagePaneRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 p-5 dark:bg-gray-950/40">
              {threadMessages.map((m, i) => (
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
