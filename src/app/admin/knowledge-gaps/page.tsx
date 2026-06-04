"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { canManageKnowledge } from "@/lib/admin/access";

type Gap = {
  id: string;
  topic: string;
  sample_question: string | null;
  status: "open" | "addressed" | "dismissed";
  times_seen: number;
  first_seen_at: string;
  last_seen_at: string;
};

type StatusFilter = "open" | "addressed" | "dismissed" | "all";

const TABS: StatusFilter[] = ["open", "addressed", "dismissed", "all"];

export default function KnowledgeGapsPage() {
  const router = useRouter();
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  const load = useCallback(
    async (status: StatusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/knowledge-gaps?status=${status}`, { headers: { "x-admin-key": adminKey } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setGaps((data.gaps as Gap[]) ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
        setGaps([]);
      } finally {
        setLoading(false);
      }
    },
    [adminKey],
  );

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const raw = localStorage.getItem("admin_user");
    const user = raw ? (JSON.parse(raw) as { role?: string; global_role?: string; is_manager?: boolean }) : null;
    if (!canManageKnowledge(user)) {
      router.push("/admin/conversations");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter);
  }, [router, filter, load]);

  async function setStatus(id: string, status: Gap["status"]) {
    setError(null);
    try {
      const res = await fetch("/api/admin/knowledge-gaps", {
        method: "PATCH",
        headers: { "x-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      await load(filter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function runBackfill() {
    if (!window.confirm("Analyze past conversations to find topics the bot couldn't answer? This runs an AI pass over recent chats and may take a minute.")) return;
    setBackfilling(true);
    setBackfillMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/knowledge-gaps/backfill", { method: "POST", headers: { "x-admin-key": adminKey } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Backfill failed");
      setBackfillMsg(`Scanned ${data.scanned} conversations — recorded ${data.gaps_recorded} gap(s) from ${data.conversations_with_gaps}.`);
      await load(filter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Knowledge Gaps</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Topics the AI assistant couldn&apos;t answer from indexed content. Add an FAQ or guide for the
            common ones, then mark them addressed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runBackfill()}
          disabled={backfilling}
          title="One-time: scan past conversations for gaps the bot didn't flag live. The agent flags new ones automatically."
          className="shrink-0 rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950"
        >
          {backfilling ? "Analyzing…" : "Analyze past chats"}
        </button>
      </div>

      {backfillMsg && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">{backfillMsg}</div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${
              filter === t
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !gaps || gaps.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No {filter === "all" ? "" : filter} knowledge gaps.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-400 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2">Topic</th>
                <th className="px-3 py-2">Example question</th>
                <th className="px-3 py-2 text-center">Asked</th>
                <th className="px-3 py-2">Last</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 font-medium">{g.topic}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{g.sample_question ?? "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex min-w-6 justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{g.times_seen}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{fmt(g.last_seen_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {g.status !== "addressed" && (
                        <button type="button" onClick={() => setStatus(g.id, "addressed")} className="rounded border border-green-300 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-50 dark:border-green-900 dark:hover:bg-green-950">Addressed</button>
                      )}
                      {g.status !== "dismissed" && (
                        <button type="button" onClick={() => setStatus(g.id, "dismissed")} className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Dismiss</button>
                      )}
                      {g.status !== "open" && (
                        <button type="button" onClick={() => setStatus(g.id, "open")} className="rounded border border-blue-300 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-900 dark:hover:bg-blue-950">Reopen</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
