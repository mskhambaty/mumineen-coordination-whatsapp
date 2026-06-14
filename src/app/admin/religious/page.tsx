"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { canMonitorReligiousChats, isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

// ─── Types (mirror the /api/admin/religious/* responses) ──────────────────────────────────────
type Metrics = {
  summary: {
    total_calls: number;
    unique_members: number;
    waaz_questions: number;
    lisan_lookups: number;
    lisan_by_status: Record<string, number>;
    open_word_requests: number;
    unreviewed_ruling_flags: number;
  };
  top_words: { word: string; count: number }[];
};
type WordRequest = {
  id: string;
  word: string;
  times_seen: number;
  last_phone_e164: string | null;
  last_seen_at: string;
};
type ChatMsg = { direction: string; body: string; created_at: string };
type Conversation = {
  phone: string;
  phone_last4: string;
  name: string | null;
  last_at: string | null;
  in_window: boolean;
  messages: ChatMsg[];
};
type RulingFlag = { phone_last4: string; message: string; detected_by: string; reviewed: boolean; created_at: string };
type Monitor = { id: string; user: { id: string; display_name: string | null; phone_e164: string | null } | null };
type DirectoryUser = { id: string; display_name: string | null; phone_e164: string | null };

function fmt(ts: string | null): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  const toneClass =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        : "border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function ReligiousDashboardPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [requests, setRequests] = useState<WordRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [flags, setFlags] = useState<RulingFlag[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);

  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // ─── Auth gate ──────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const user = readAdminUser();
    if (!user || !canMonitorReligiousChats(user)) {
      router.push("/admin/login");
      return;
    }
    setIsAdmin(isAdminOrLeadership(user));
    setAuthorized(true);
  }, [router]);

  const loadAll = useCallback(async () => {
    const [m, w, c, f] = await Promise.all([
      apiFetch("/api/admin/religious/metrics"),
      apiFetch("/api/admin/religious/word-requests?status=open"),
      apiFetch("/api/admin/religious/conversations"),
      apiFetch("/api/admin/ruling-flags"),
    ]);
    if (m.ok) setMetrics(await m.json());
    if (w.ok) setRequests((await w.json()).requests ?? []);
    if (c.ok) setConversations((await c.json()).conversations ?? []);
    if (f.ok) setFlags((await f.json()).recent ?? []);
  }, []);

  const loadMonitors = useCallback(async () => {
    const res = await apiFetch("/api/admin/religious/monitors");
    if (res.ok) setMonitors((await res.json()).members ?? []);
  }, []);

  useEffect(() => {
    if (!authorized) return;
    void loadAll();
    void loadMonitors();
  }, [authorized, loadAll, loadMonitors]);

  // Admins load the user directory for the "add monitor" picker.
  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      const res = await apiFetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        const list = (Array.isArray(data) ? data : data.users) ?? [];
        setDirectory(list.map((u: DirectoryUser) => ({ id: u.id, display_name: u.display_name, phone_e164: u.phone_e164 })));
      }
    })();
  }, [isAdmin]);

  if (!authorized) return null;

  const active = conversations.find((c) => c.phone === activePhone) ?? null;

  async function resolveRequest(id: string, status: "added" | "dismissed") {
    const res = await apiFetch("/api/admin/religious/word-requests", { method: "PATCH", body: JSON.stringify({ id, status }) });
    if (res.ok) setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  async function sendReply() {
    if (!active || !reply.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await apiFetch("/api/admin/religious/reply", {
        method: "POST",
        body: JSON.stringify({ phone: active.phone, text: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setReply("");
      setNotice("Reply sent.");
      void loadAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function addMonitor(userId: string) {
    if (!userId) return;
    const res = await apiFetch("/api/admin/religious/monitors", { method: "POST", body: JSON.stringify({ user_id: userId }) });
    if (res.ok) void loadMonitors();
  }
  async function removeMonitor(id: string) {
    const res = await apiFetch(`/api/admin/religious/monitors/${id}`, { method: "DELETE" });
    if (res.ok) void loadMonitors();
  }

  const s = metrics?.summary;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Religious chats</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Monitoring for Waaz / Lisan questions — last 30 days. Separate from event &amp; logistics admin.
        </p>
      </div>

      {/* Metrics */}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard label="Tool calls" value={s.total_calls} />
          <StatCard label="Members" value={s.unique_members} />
          <StatCard label="Waaz Qs" value={s.waaz_questions} />
          <StatCard label="Lisan lookups" value={s.lisan_lookups} />
          <StatCard label="Not found" value={s.lisan_by_status?.not_found ?? 0} tone="amber" />
          <StatCard label="Missing words" value={s.open_word_requests} tone={s.open_word_requests ? "amber" : undefined} />
          <StatCard label="Ruling flags" value={s.unreviewed_ruling_flags} tone={s.unreviewed_ruling_flags ? "red" : undefined} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Missing-word queue */}
        <Section title={`Missing words (${requests.length})`} action={<a href="/admin/knowledge" className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">Add words →</a>}>
          {requests.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No open requests. 🎉</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{r.word}</span>
                    <span className="ml-2 text-xs text-gray-400">×{r.times_seen} · {fmt(r.last_seen_at)}</span>
                  </span>
                  <span className="flex gap-2">
                    <button onClick={() => resolveRequest(r.id, "added")} className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700">Added</button>
                    <button onClick={() => resolveRequest(r.id, "dismissed")} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">Dismiss</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Top words */}
        <Section title="Top words asked">
          {!metrics?.top_words.length ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No data yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {metrics.top_words.map((w) => (
                <li key={w.word} className="flex justify-between">
                  <span className="text-gray-800 dark:text-gray-200">{w.word}</span>
                  <span className="text-gray-400">{w.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Conversations + reply */}
      <Section title="Religious chats">
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {conversations.map((c) => (
              <li key={c.phone}>
                <button
                  onClick={() => { setActivePhone(c.phone); setNotice(null); }}
                  className={`w-full rounded px-3 py-2 text-left text-sm ${activePhone === c.phone ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                >
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{c.name ?? `…${c.phone_last4}`}</span>
                    {!c.in_window && <span className="text-[10px] uppercase text-amber-600 dark:text-amber-400">closed</span>}
                  </div>
                  <div className="text-xs text-gray-400">{fmt(c.last_at)}</div>
                </button>
              </li>
            ))}
            {conversations.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">No religious chats yet.</li>}
          </ul>

          <div className="flex min-h-[24rem] flex-col rounded-lg border border-gray-100 dark:border-gray-800">
            {!active ? (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-400">Select a conversation</div>
            ) : (
              <>
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {active.messages.map((m, i) => (
                    <div key={i} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === "inbound" ? "bg-gray-100 dark:bg-gray-800" : "ml-auto bg-blue-600 text-white"}`}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`mt-1 text-[10px] ${m.direction === "inbound" ? "text-gray-400" : "text-blue-100"}`}>{fmt(m.created_at)}</div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-100 p-3 dark:border-gray-800">
                  {active.in_window ? (
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
                  ) : (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      This member is outside WhatsApp&apos;s 24-hour window — a free-text reply can&apos;t be delivered. Use an approved template (WhatsApp Templates) to reach them.
                    </p>
                  )}
                  {notice && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{notice}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      </Section>

      {/* Ruling flags */}
      <Section title={`Ruling flags (${flags.length})`}>
        {flags.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No flagged ruling questions.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
            {flags.map((f, i) => (
              <li key={i} className="py-2">
                <div className="text-gray-800 dark:text-gray-200">{f.message}</div>
                <div className="text-xs text-gray-400">…{f.phone_last4} · {f.detected_by} · {fmt(f.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Monitors (admin only) */}
      {isAdmin && (
        <Section title={`Religious monitors (${monitors.length})`}>
          <ul className="mb-3 divide-y divide-gray-100 text-sm dark:divide-gray-800">
            {monitors.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2">
                <span className="text-gray-800 dark:text-gray-200">{m.user?.display_name ?? m.user?.phone_e164 ?? "—"}</span>
                <button onClick={() => removeMonitor(m.id)} className="text-xs text-red-600 hover:underline dark:text-red-400">Remove</button>
              </li>
            ))}
            {monitors.length === 0 && <li className="py-2 text-gray-500">No monitors yet.</li>}
          </ul>
          <select
            onChange={(e) => { void addMonitor(e.target.value); e.target.value = ""; }}
            defaultValue=""
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          >
            <option value="" disabled>Add a monitor…</option>
            {directory
              .filter((u) => !monitors.some((m) => m.user?.id === u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>{u.display_name ?? u.phone_e164 ?? u.id}</option>
              ))}
          </select>
        </Section>
      )}
    </div>
  );
}
