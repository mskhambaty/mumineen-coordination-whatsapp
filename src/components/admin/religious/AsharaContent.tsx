"use client";

import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/admin/client";
import ContentBucketEditor from "@/components/admin/ContentBucketEditor";
import {
  ASHARA_CATEGORIES,
  ASHARA_ROWS,
  DEFAULT_ACTIVE_YEAR,
  defaultStatus,
  istibsaarSearchUrl,
  majlisLabel,
  majlisRowForToday,
  topicTitle,
  type AsharaCategory,
  type AsharaRow,
} from "@/lib/knowledge/ashara-config";

// The Ashara majlis × category content grid — extracted from /admin/ashara so it can live inside
// the Waaz Talaqqi "Content" tab. This is where the daily majlis content (incl. the active year,
// 1448) is ingested. Auth + page container are the parent shell's job; this renders inside a tab.

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
  theme: string | null;
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

export default function AsharaContent() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [year, setYear] = useState(DEFAULT_ACTIVE_YEAR);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeMsg, setThemeMsg] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/religious-topics");
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

  const cellMap = useMemo(() => {
    const m = new Map<string, Topic>();
    for (const t of topics) {
      if (t.year_hijri !== year || !t.category) continue;
      const key = `${t.category}:${t.is_ashura ? "ashura" : t.majlis_number}`;
      m.set(key, t);
    }
    return m;
  }, [topics, year]);

  const cellKey = (cat: AsharaCategory, row: AsharaRow) => `${cat.key}:${row.isAshura ? "ashura" : row.majlisNumber}`;

  const todayRowIdx = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return majlisRowForToday(year, todayIso);
  }, [year]);

  const progress = useMemo(() => {
    let indexed = 0;
    for (const t of cellMap.values()) if (t.status === "indexed") indexed++;
    return { indexed, total: ASHARA_ROWS.length * ASHARA_CATEGORIES.length };
  }, [cellMap]);

  const rowDone = (row: AsharaRow) => ASHARA_CATEGORIES.filter((c) => cellMap.get(cellKey(c, row))?.status === "indexed").length;

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

  async function backfillThemes() {
    setThemeBusy(true);
    setThemeMsg(null);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/religious-topics/backfill-themes", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to generate themes");
      setThemeMsg(`Generated ${data.updated ?? 0} theme(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate themes");
    } finally {
      setThemeBusy(false);
    }
  }

  async function seedRow(row: AsharaRow) {
    const key = `seed:${row.label}`;
    setBusyCell(key);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/ashara/seed", {
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
    const key = cellKey(cat, row);
    setBusyCell(key);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/religious-topics", {
        method: "POST",
        body: JSON.stringify({
          title: topicTitle(cat.label, year, row.majlisNumber, row.isAshura),
          year_hijri: year,
          majlis_number: row.majlisNumber,
          is_ashura: row.isAshura,
          category: cat.key,
          language: cat.language,
          status: defaultStatus(cat.language),
          source_url: istibsaarSearchUrl(row.majlisNumber, row.isAshura, year),
          source_label: `Istibsaar — ${cat.label}, ${majlisLabel(row.majlisNumber, row.isAshura)} (${year}H)`,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to create");
      const created = (await res.json()) as { id: string };
      const fresh = (await (await apiFetch("/api/admin/religious-topics")).json()).topics as Topic[];
      setTopics(fresh);
      setEditing(fresh.find((t) => t.id === created.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusyCell(null);
    }
  }

  const overviewBlock = useMemo(
    () => topics.find((t) => t.category === "overview" && t.year_hijri === year) ?? null,
    [topics, year],
  );

  async function openOverview() {
    if (overviewBlock) { setEditing(overviewBlock); return; }
    setBusyCell("overview");
    setError(null);
    try {
      const res = await apiFetch("/api/admin/religious-topics", {
        method: "POST",
        body: JSON.stringify({
          title: `Overview — Ashara ${year}H`,
          year_hijri: year, majlis_number: null, is_ashura: false,
          category: "overview", language: "en", status: "placeholder",
          source_label: `Reflections — Ashara ${year}H`,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to create");
      const created = (await res.json()) as { id: string };
      const fresh = (await (await apiFetch("/api/admin/religious-topics")).json()).topics as Topic[];
      setTopics(fresh);
      setEditing(fresh.find((t) => t.id === created.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusyCell(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Daily majlis content</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">One row per majlis, one column per type. Click any cell to add its content.</p>
        </div>
        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={() => void backfillThemes()}
            disabled={themeBusy}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Generate a one-line theme for any block that has content but no theme yet"
          >
            {themeBusy ? "Generating…" : "Generate missing themes"}
          </button>
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
      </div>
      {themeMsg && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">{themeMsg}</div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div>
            <p className="font-medium">How to fill this in</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-600 dark:text-gray-400">
              <li><span className="font-medium text-gray-800 dark:text-gray-200">English</span> (Reflections, Tazyeen, Al-Dars): open the cell, click <span className="font-medium">↗ source</span> to read the article, paste it in, Save.</li>
              <li><span className="font-medium text-gray-800 dark:text-gray-200">Lisan</span> (Jumla, Kalema, Unwaan): open the cell, read the original via <span className="font-medium">↗ source</span>, type the <span className="font-medium">English translation</span>, Save.</li>
              <li>Saving indexes it for the WhatsApp agent and turns the chip green.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE.indexed}`}>Indexed</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE.pending_translation}`}>Needs translation</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE.placeholder}`}>Awaiting content</span>
            </div>
            <div className="w-full md:w-56">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Progress</span>
                <span>{progress.indexed} / {progress.total} indexed</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="h-full rounded-full bg-green-500" style={{ width: `${progress.total ? (progress.indexed / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {todayRowIdx != null && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          <span className="font-semibold">Today is {ASHARA_ROWS[todayRowIdx].label}.</span> Fill in its content below (highlighted row).
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <button
        type="button"
        onClick={() => void openOverview()}
        disabled={busyCell === "overview"}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-blue-400 dark:border-gray-800 dark:bg-gray-900"
      >
        <div>
          <span className="text-sm font-semibold">Overall theme — Ashara {year}H</span>
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            {busyCell === "overview" ? "Creating…" : overviewBlock?.content?.trim()
              ? "Edit the whole-Ashara brief the bot uses for “what was last year about”"
              : "Not written yet — click to add the whole-Ashara brief"}
          </span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${overviewBlock?.content?.trim() ? STATUS_STYLE.indexed : STATUS_STYLE.placeholder}`}>
          {overviewBlock?.content?.trim() ? "Indexed" : "Empty"}
        </span>
      </button>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
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
                ASHARA_ROWS.map((row, rowIdx) => {
                  const isToday = rowIdx === todayRowIdx;
                  const done = rowDone(row);
                  return (
                    <tr key={row.label} className={isToday ? "bg-blue-50/60 dark:bg-blue-950/30" : undefined}>
                      <td className={`whitespace-nowrap px-3 py-3 align-top font-medium text-gray-700 dark:text-gray-200 ${isToday ? "border-l-2 border-blue-500" : ""}`}>
                        <div className="flex items-center gap-2">
                          {row.label}
                          {isToday && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Today</span>}
                        </div>
                        <div className="mt-0.5 text-[11px] font-normal text-gray-400">{done}/{ASHARA_CATEGORIES.length} done</div>
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
                          <td key={cat.key} className="px-2 py-2 align-top">
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
                                  {t.theme && <span className="line-clamp-2 text-[11px] italic text-gray-400">{t.theme}</span>}
                                </>
                              ) : (
                                <span className="text-xs">{busyCell === key ? "Creating…" : "+ Add"}</span>
                              )}
                            </button>
                            {t?.source_url && (
                              <a
                                href={t.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 block text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                              >
                                ↗ source
                              </a>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

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
          showSource
          initialSourceUrl={editing.source_url}
          showTheme
          initialTheme={editing.theme}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}
