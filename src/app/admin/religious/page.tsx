"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { canMonitorReligiousChats, isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import ReligiousInbox from "@/components/admin/religious/ReligiousInbox";
import ContentTab from "@/components/admin/religious/ContentTab";
import DictionaryTab from "@/components/admin/religious/DictionaryTab";
import FlagsTab from "@/components/admin/religious/FlagsTab";
import OverviewTab from "@/components/admin/religious/OverviewTab";
import TeamTab from "@/components/admin/religious/TeamTab";
import {
  DirectoryUser,
  KpiCard,
  Metrics,
  Monitor,
  RulingFlag,
  TabKey,
  Tabs,
  Topic,
  WordRequest,
} from "@/components/admin/religious/ui";

// One-line description shown under the tab bar for the active tab.
const TAB_BLURB: Record<TabKey, string> = {
  overview: "What needs attention today — content to upload, gaps to fill, flags to review.",
  inbox: "Live inbox of religious & Lisan chats. Switch a chat to Manual to reply yourself.",
  dictionary: "Words members asked for that aren't in the dictionary, plus the full Lisan dictionary.",
  content: "Daily majlis content per year, plus supplementary documents and Waaz FAQ blocks.",
  flags: "Personal-fatwa questions the bot refused, kept for awareness (not escalations).",
  team: "Who can access this Waaz Talaqqi dashboard.",
};

// Tiny inline icons (no icon lib in this repo).
const I = {
  calls: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M2 4a2 2 0 012-2h2.6a1 1 0 01.95.68l1 3a1 1 0 01-.27 1.05l-1.2 1.2a12 12 0 005.06 5.06l1.2-1.2a1 1 0 011.05-.27l3 1a1 1 0 01.68.95V16a2 2 0 01-2 2h-1C7.6 18 2 12.4 2 5V4z"/></svg>,
  member: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M10 10a3 3 0 100-6 3 3 0 000 6zm-6 7a6 6 0 1112 0H4z"/></svg>,
  book: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h5V3H4zm7 0v14h5a2 2 0 002-2V5a2 2 0 00-2-2h-5z"/></svg>,
  word: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M3 4h14v2H3V4zm0 5h14v2H3V9zm0 5h9v2H3v-2z"/></svg>,
  warn: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M8.3 3.3a2 2 0 013.4 0l6 10A2 2 0 0116 16H4a2 2 0 01-1.7-2.7l6-10zM9 8v3h2V8H9zm0 4v2h2v-2H9z"/></svg>,
  flag: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M4 2a1 1 0 011 1v1h9l-2 3 2 3H5v7H3V3a1 1 0 011-1z"/></svg>,
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

export default function WaazTalaqqiPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [tab, setTab] = useState<TabKey>("overview");
  const [days, setDays] = useState(30);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [requests, setRequests] = useState<WordRequest[]>([]);
  const [flags, setFlags] = useState<RulingFlag[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  // Auth gate + initial tab from the URL.
  useEffect(() => {
    const user = readAdminUser();
    if (!user || !canMonitorReligiousChats(user)) {
      router.push("/admin/login");
      return;
    }
    setIsAdmin(isAdminOrLeadership(user));
    const urlTab = new URLSearchParams(window.location.search).get("tab") as TabKey | null;
    if (urlTab) setTab(urlTab);
    setAuthorized(true);
  }, [router]);

  function changeTab(next: TabKey) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  const loadAll = useCallback(async () => {
    const from = daysAgoIso(days);
    const [m, w, f] = await Promise.all([
      apiFetch(`/api/admin/religious/metrics?from=${from}`),
      apiFetch("/api/admin/religious/word-requests?status=open"),
      apiFetch("/api/admin/ruling-flags"),
    ]);
    if (m.ok) setMetrics(await m.json());
    if (w.ok) setRequests((await w.json()).requests ?? []);
    if (f.ok) setFlags((await f.json()).recent ?? []);
  }, [days]);

  const loadMonitors = useCallback(async () => {
    const res = await apiFetch("/api/admin/religious/monitors");
    if (res.ok) setMonitors((await res.json()).members ?? []);
  }, []);

  useEffect(() => {
    if (authorized) void loadAll();
  }, [authorized, loadAll]);

  // Topics power the Overview "Today's uploads" panel + the Content tab. Open to the whole monitor
  // team now (the religious-topics endpoint accepts canManageReligiousContent).
  useEffect(() => {
    if (!authorized) return;
    void (async () => {
      const res = await apiFetch("/api/admin/religious-topics");
      if (res.ok) setTopics((await res.json()).topics ?? []);
    })();
  }, [authorized]);

  useEffect(() => {
    if (authorized) void loadMonitors();
  }, [authorized, loadMonitors]);

  useEffect(() => {
    if (!authorized || !isAdmin) return;
    void (async () => {
      const res = await apiFetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        const listed = (Array.isArray(data) ? data : data.users) ?? [];
        setDirectory(listed.map((u: DirectoryUser) => ({ id: u.id, display_name: u.display_name, phone_e164: u.phone_e164 })));
      }
    })();
  }, [authorized, isAdmin]);

  async function resolveRequest(id: string, status: "added" | "dismissed") {
    const res = await apiFetch("/api/admin/religious/word-requests", { method: "PATCH", body: JSON.stringify({ id, status }) });
    if (res.ok) setRequests((prev) => prev.filter((r) => r.id !== id));
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
  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; badge?: number }[] = [
      { key: "overview", label: "Overview" },
      { key: "inbox", label: "Inbox" },
    ];
    // Dictionary + Content are part of the Waaz Talaqqi team's job, so the whole team sees them
    // (the underlying APIs accept canManageReligiousContent). Team (access control) stays admin-only.
    list.push({ key: "dictionary", label: "Dictionary", badge: s?.open_word_requests || undefined });
    list.push({ key: "content", label: "Content" });
    list.push({ key: "flags", label: "Flags", badge: s?.unreviewed_ruling_flags || undefined });
    if (isAdmin) list.push({ key: "team", label: "Team" });
    return list;
  }, [isAdmin, s?.open_word_requests, s?.unreviewed_ruling_flags]);

  // If the URL/tab points somewhere this user can't see, fall back to Overview.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "overview";

  if (!authorized) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Waaz Talaqqi</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Religious chats, dictionary &amp; content — separate from event &amp; logistics admin.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          {isAdmin && (
            <a
              href={`/api/admin/conversations/religious-export?from=${daysAgoIso(days)}`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Export
            </a>
          )}
        </div>
      </div>

      {/* KPI band — people first, tool calls last (de-emphasized). Hidden on mobile, where the
          team works the tabs; the headline counts live in the panels/badges anyway. */}
      {s && (
        <div className="mb-5 hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Mumineen" value={s.unique_members} icon={I.member} tone="blue" />
          <KpiCard label="Waaz Qs" value={s.waaz_questions} icon={I.book} />
          <KpiCard label="Word meanings" value={s.lisan_lookups} icon={I.word} />
          <KpiCard label="Missing words" value={s.open_word_requests} icon={I.warn} tone={s.open_word_requests ? "amber" : "neutral"} />
          <KpiCard label="Ruling flags" value={s.unreviewed_ruling_flags} icon={I.flag} tone={s.unreviewed_ruling_flags ? "red" : "neutral"} />
          <KpiCard label="Tool calls" value={s.total_calls} icon={I.calls} />
        </div>
      )}

      {/* Tabs + active-tab description */}
      <div className="mb-5">
        <Tabs tabs={tabs} active={activeTab} onChange={changeTab} />
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{TAB_BLURB[activeTab]}</p>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab metrics={metrics} topics={topics} canManage onJump={changeTab} />
      )}
      {activeTab === "inbox" && <ReligiousInbox />}
      {activeTab === "dictionary" && <DictionaryTab wordRequests={requests} onResolve={resolveRequest} />}
      {activeTab === "content" && <ContentTab />}
      {activeTab === "flags" && <FlagsTab flags={flags} />}
      {activeTab === "team" && isAdmin && <TeamTab monitors={monitors} directory={directory} onAdd={addMonitor} onRemove={removeMonitor} />}
    </div>
  );
}
