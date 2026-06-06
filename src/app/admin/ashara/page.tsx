"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { canManageKnowledge } from "@/lib/admin/access";
import ContentBucketEditor from "@/components/admin/ContentBucketEditor";
import {
  ASHARA_CATEGORIES,
  ASHARA_ROWS,
  DEFAULT_ACTIVE_YEAR,
  defaultStatus,
  majlisLabel,
  topicTitle,
  type AsharaCategory,
  type AsharaRow,
} from "@/lib/knowledge/ashara-config";

type Topic = {
  id: string;
  title: string;
  content: string;
  entry_count: number;
  chunk_count: number;
  source_url: string | null;
  year_hijri: string | null;
  majlis_number: number | null;
  is_ashura: boolean;
  category: string | null;
  language: string;
  status: string;
};

const STATUS_STYLE: Record<string, string> = {
  indexed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  pending_translation: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  placeholder: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};
const STATUS_LABEL: Record<string, string> = {
  indexed: "Indexed",
  pending_translation: "Needs translation",
  placeholder: "Awaiting content",
};

export default function AsharaDashboardPage() {
  const router = useRouter();
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  const [topics, setTopics] = useState<Topic[]>([]);
  const [year, setYear] = useState(DEFAULT_ACTIVE_YEAR);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [editing, setEditing] = useState<Topic | null>(null);

  function api(path: string, init?: RequestInit) {
    return fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey, ...(init?.headers ?? {}) },
    });
  }

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
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api("/api/admin/religious-topics");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load");
      setTopics(((await res.json()).topics ?? []) as Topic[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  const years = useMemo(() => {
    const set = new Set<string>([DEFAULT_ACTIVE_YEAR]);
    for (const t of topics) if (t.year_hijri) set.add(t.year_hijri);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [topics]);

  // Index topics for the active year by category + majlis/ashura for O(1) cell lookup.
  const cellMap = useMemo(() => {
    const m = new Map<string, Topic>();
    for (const t of topics) {
      if (t.year_hijri !== year || !t.category) continue;
      const key = `${t.category}:${t.is_ashura ? "ashura" : t.majlis_number}`;
      m.set(key, t);
    }
    return m;
  }, [topics, year]);

  const cellKey = (cat: AsharaCategory, row: AsharaRow) =>
    `${cat.key}:${row.isAshura ? "ashura" : row.majlisNumber}`;

  const pendingQueue = useMemo(() => {
    return topics
      .filter((t) => t.year_hijri === year && t.status === "pending_translation")
      .sort((a, b) => {
        const aSame = ASHARA_CATEGORIES.find((c) => c.key === a.category)?.sameDayTranslate ? 0 : 1;
        const bSame = ASHARA_CATEGORIES.find((c) => c.key === b.category)?.sameDayTranslate ? 0 : 1;
        if (aSame !== bSame) return aSame - bSame;
        return (a.majlis_number ?? 99) - (b.majlis_number ?? 99);
      });
  }, [topics, year]);

  async function seedRow(row: AsharaRow) {
    const key = `seed:${row.label}`;
    setBusyCell(key);
    setError(null);
    try {
      const res = await api("/api/admin/ashara/seed", {
        method: "POST",
        body: JSON.stringify({ year, majlis_number: row.majlisNumber, is_ashura: row.isAshura }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to seed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed");
    } finally {
      setBusyCell(null);
    }
  }

  async function openCell(cat: AsharaCategory, row: AsharaRow) {
    const existing = cellMap.get(cellKey(cat, row));
    if (existing) {
      setEditing(existing);
      return;
    }
    // Create the slot with its per-majlis metadata, then open the editor.
    const key = cellKey(cat, row);
    setBusyCell(key);
    setError(null);
    try {
      const res = await api("/api/admin/religious-topics", {
        method: "POST",
        body: JSON.stringify({
          title: topicTitle(cat.label, year, row.majlisNumber, row.isAshura),
          year_hijri: year,
          majlis_number: row.majlisNumber,
          is_ashura: row.isAshura,
          category: cat.key,
          language: cat.language,
          status: defaultStatus(cat.language),
          source_label: `Istibsaar — ${cat.label}, ${majlisLabel(row.majlisNumber, row.isAshura)} (${year}H)`,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to create");
      const created = (await res.json()) as { id: string };
      // Reload so the new cell shows, then open its editor.
      const fresh = (await (await api("/api/admin/religious-topics")).json()).topics as Topic[];
      setTopics(fresh);
      setEditing(fresh.find((t) => t.id === created.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusyCell(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Ashara Daily Content</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            Per-majlis content grid. English categories (Reflections, Tazyeen, Al-Dars) are indexed directly;
            Lisan ud Dawat categories (Jumla, Kalema, Unwaan) wait in the translation queue until you paste the
            English. Click a cell to add or edit that majlis&apos;s content; saving re-indexes it for the agent.
          </p>
        </div>
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Ashara year (Hijri)
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1 block rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}H</option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Grid */}
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Majlis</th>
                {ASHARA_CATEGORIES.map((c) => (
                  <th key={c.key} className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    {c.label}
                    {c.language === "lisan" && <span className="ml-1 text-[10px] font-normal lowercase text-amber-600">(lisan)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={ASHARA_CATEGORIES.length + 1} className="px-3 py-8 text-center text-gray-500">Loading…</td></tr>
              ) : (
                ASHARA_ROWS.map((row) => (
                  <tr key={row.label}>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-gray-700 dark:text-gray-200">
                      <div>{row.label}</div>
                      <button
                        type="button"
                        disabled={busyCell === `seed:${row.label}`}
                        onClick={() => void seedRow(row)}
                        className="mt-1 text-[11px] font-normal text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                      >
                        {busyCell === `seed:${row.label}` ? "Seeding…" : "Seed all 6"}
                      </button>
                    </td>
                    {ASHARA_CATEGORIES.map((cat) => {
                      const t = cellMap.get(cellKey(cat, row));
                      const key = cellKey(cat, row);
                      return (
                        <td key={cat.key} className="px-2 py-2">
                          <button
                            type="button"
                            disabled={busyCell === key}
                            onClick={() => void openCell(cat, row)}
                            className={`flex w-full min-w-[120px] flex-col items-start gap-1 rounded-md border p-2 text-left transition hover:border-blue-400 dark:border-gray-700 ${
                              t ? "bg-gray-50 dark:bg-gray-800/60" : "border-dashed text-gray-400"
                            }`}
                          >
                            {t ? (
                              <>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[t.status] ?? ""}`}>
                                  {STATUS_LABEL[t.status] ?? t.status}
                                </span>
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                  {t.entry_count > 0 ? `${t.entry_count} entr${t.entry_count !== 1 ? "ies" : "y"}` : "empty"} · {t.chunk_count} chunks
                                </span>
                              </>
                            ) : (
                              <span className="text-xs">{busyCell === key ? "Creating…" : "+ Add"}</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Translation queue */}
        <aside className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-sm font-semibold">Needs translation</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Lisan ud Dawat items awaiting English. Same-day items (Jumla / Kalema / Unwaan) are listed first.
          </p>
          <div className="mt-3 space-y-2">
            {pendingQueue.length === 0 ? (
              <p className="text-xs text-gray-400">Nothing pending for {year}H.</p>
            ) : (
              pendingQueue.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setEditing(t)}
                  className="block w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs hover:border-amber-400 dark:border-amber-900 dark:bg-amber-950/40"
                >
                  <span className="font-medium">{t.title}</span>
                  {t.source_url && <span className="mt-0.5 block truncate text-[11px] text-blue-600 dark:text-blue-400">{t.source_url}</span>}
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

      {editing && (
        <ContentBucketEditor
          title={editing.title}
          subtitle={
            ASHARA_CATEGORIES.find((c) => c.key === editing.category)?.language === "lisan"
              ? "Lisan ud Dawat content — paste the English translation here. Saving indexes it and clears it from the translation queue."
              : "Waaz Talaqi content — keep a respectful, sourced tone. Separate entries with a blank line. Saving re-indexes it for the agent."
          }
          initialContent={editing.content}
          endpoint={`/api/admin/religious-topics/${editing.id}`}
          adminKey={adminKey}
          showSource
          initialSourceUrl={editing.source_url}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </main>
  );
}
