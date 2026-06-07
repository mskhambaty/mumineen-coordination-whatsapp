"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { canManageKnowledge } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

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

  // Export state
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (status: StatusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/admin/knowledge-gaps?status=${status}`);
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
    [],
  );

  useEffect(() => {
    const user = readAdminUser();
    if (!user) { router.push("/admin/login"); return; }
    if (!canManageKnowledge(user)) { router.push("/admin/conversations"); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter);
  }, [router, filter, load]);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const form = new FormData();
      if (referenceFile) form.append("reference", referenceFile);

      const res = await apiFetch("/api/admin/knowledge-gaps/export", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      a.download = match?.[1] ?? "knowledge-gaps.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Knowledge Gaps</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Topics the AI couldn&apos;t answer. Export net-new gaps to paste into Google Sheets — the team fills answers there and the cron picks them up automatically.
          </p>
        </div>
        <Link
          href="/admin/prompt"
          className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Edit agent prompt
        </Link>
      </div>

      {/* Export panel */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
        <p className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Export to Google Sheets</p>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Upload last exported sheet <span className="text-gray-400">(optional — for dedup)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setReferenceFile(e.target.files?.[0] ?? null)}
              className="block text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-1 file:text-sm file:font-medium dark:file:bg-gray-700 dark:file:text-gray-200"
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="mt-4 self-end rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {exporting ? "Exporting…" : referenceFile ? "Export (deduped)" : "Export all open"}
          </button>
          {referenceFile && (
            <button
              type="button"
              onClick={() => { setReferenceFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              className="mt-4 self-end text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              Clear file
            </button>
          )}
        </div>
        {referenceFile && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Reference: <span className="font-medium">{referenceFile.name}</span> — only gaps not already in this sheet will be exported.
          </p>
        )}
      </div>

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
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2">Status</th>
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
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                      g.status === "open"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        : g.status === "addressed"
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                    }`}>{g.status}</span>
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
