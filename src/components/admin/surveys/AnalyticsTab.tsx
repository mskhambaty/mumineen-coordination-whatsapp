"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";

// Feedback analytics dashboard — every aggregate reflects the active filter set (which forms/samples,
// area, section, and the responder's personal attributes), plus an AI pass over the free-text and
// negative-reason comments for sentiment + actionable areas of improvement.

const AREAS = ["general", "mawaid", "flow", "parking_transport", "audio_video", "accommodation", "seating"];

type Row = { key: string; sentiment: number | null; responses: number; people: number };
type QRow = { question_id: string; text: string; section: string | null; sentiment: number | null; responses: number; breakdown: Record<string, number> };
type Comment = { text: string; area: string | null; section: string | null; question: string | null; sentiment: number | null };
type Data = {
  forms: { id: string; title: string; status: string; tags: string[]; event_date: string | null; sent_at: string | null }[];
  options: { jamaats: string[]; categories: string[]; sections: { id: string; title: string }[] };
  by_day?: Row[];
  overview: { sent: number; responded: number; response_rate: number; avg_sentiment: number | null; scored_answers: number; comment_count: number };
  distribution: { score: number; count: number }[];
  by_section: Row[];
  by_area: Row[];
  by_question: QRow[];
  by_attribute: { local_mehman: Row[]; gender: Row[]; age: Row[]; rahat: Row[]; jamaat: Row[] };
  comments: Comment[];
};

type AiTheme = { theme: string; sentiment: string; mentions: number; example: string };
type AiImprovement = { area: string; suggestion: string; severity: string };
type Ai = { overall_sentiment: string; sentiment_score_1_5: number; summary: string; themes: AiTheme[]; improvements: AiImprovement[]; positives: string[] };

type Filters = {
  formIds: string[]; areas: string[]; sectionIds: string[]; includeTest: boolean;
  gender?: "M" | "F"; ageMin?: number; ageMax?: number; localMehman?: "Local" | "Mehman";
  rahatOnly: boolean; jamaats: string[]; categories: string[]; dateFrom?: string; dateTo?: string;
};
const EMPTY: Filters = { formIds: [], areas: [], sectionIds: [], includeTest: false, rahatOnly: false, jamaats: [], categories: [] };

function Badge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-gray-400">—</span>;
  const color = value >= 4 ? "bg-emerald-600" : value >= 3 ? "bg-amber-500" : "bg-red-600";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-gray-200 dark:bg-gray-700"><span className={`block h-full ${color}`} style={{ width: `${(value / 5) * 100}%` }} /></span>
      <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{value.toFixed(1)}/5</span>
    </span>
  );
}

function RowTable({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <p className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{title}</p>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-3 py-0.5">
          <span className="truncate text-xs text-gray-700 dark:text-gray-300">{r.key} <span className="text-gray-400">({r.people} {r.people === 1 ? "person" : "people"} · {r.responses} answers)</span></span>
          <Badge value={r.sentiment} />
        </div>
      ))}
    </div>
  );
}

const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300"}`;
const inputCls = "rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

type DrillRow = { name: string | null; its: string | null; question: string | null; answer: string | null; section: string | null; area: string | null; reason: string | null };

function buildBody(fl: Filters): Record<string, unknown> {
  const body: Record<string, unknown> = { includeTest: fl.includeTest, rahatOnly: fl.rahatOnly };
  if (fl.formIds.length) body.formIds = fl.formIds;
  if (fl.areas.length) body.areas = fl.areas;
  if (fl.sectionIds.length) body.sectionIds = fl.sectionIds;
  if (fl.gender) body.gender = fl.gender;
  if (fl.localMehman) body.localMehman = fl.localMehman;
  if (fl.ageMin != null) body.ageMin = fl.ageMin;
  if (fl.ageMax != null) body.ageMax = fl.ageMax;
  if (fl.jamaats.length) body.jamaats = fl.jamaats;
  if (fl.categories.length) body.categories = fl.categories;
  if (fl.dateFrom) body.dateFrom = fl.dateFrom;
  if (fl.dateTo) body.dateTo = fl.dateTo;
  return body;
}

export function AnalyticsTab() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [ai, setAi] = useState<Ai | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ score: number; rows: DrillRow[]; loading: boolean } | null>(null);

  const load = useCallback(async (fl: Filters) => {
    setLoading(true);
    const res = await apiFetch("/api/admin/surveys/analytics", { method: "POST", body: JSON.stringify(buildBody(fl)) });
    setData(res.ok ? await res.json() : null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(EMPTY); }, [load]);

  async function openDrill(score: number) {
    setDrill({ score, rows: [], loading: true });
    const res = await apiFetch("/api/admin/surveys/analytics", { method: "POST", body: JSON.stringify({ ...buildBody(filters), drillScore: score }) });
    const json = await res.json().catch(() => ({}));
    setDrill({ score, rows: (json.responses as DrillRow[]) ?? [], loading: false });
  }

  function toggleArr(key: "formIds" | "areas" | "sectionIds" | "jamaats" | "categories", v: string) {
    setFilters((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }));
  }

  async function runAi() {
    if (!data?.comments.length) return;
    setAiBusy(true); setAiErr(null); setAi(null);
    const scope = [
      filters.formIds.length ? `${filters.formIds.length} form(s)` : "all forms",
      filters.areas.length ? `areas: ${filters.areas.join(", ")}` : null,
      filters.localMehman, filters.gender, filters.rahatOnly ? "rahat only" : null,
    ].filter(Boolean).join(" · ");
    const res = await apiFetch("/api/admin/surveys/analytics/ai", { method: "POST", body: JSON.stringify({ comments: data.comments.map((c) => ({ text: c.text, area: c.area })), scope }) });
    const json = await res.json().catch(() => ({}));
    setAiBusy(false);
    if (res.ok && json.analysis) setAi(json.analysis as Ai);
    else setAiErr(json.error ?? "AI analysis failed.");
  }

  const o = data?.overview;
  const maxDist = Math.max(1, ...(data?.distribution ?? []).map((d) => d.count));
  const sevColor: Record<string, string> = { high: "text-red-600 dark:text-red-400", medium: "text-amber-600 dark:text-amber-400", low: "text-gray-500 dark:text-gray-400" };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Filters — every chart below reflects these</p>
        <div>
          <p className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">Forms / samples {filters.formIds.length ? `(${filters.formIds.length})` : "(all)"}</p>
          <div className="flex flex-wrap gap-1.5">
            {(data?.forms ?? []).map((fm) => (
              <button key={fm.id} onClick={() => toggleArr("formIds", fm.id)} className={chip(filters.formIds.includes(fm.id))}>
                {fm.title}{fm.tags.length ? ` · ${fm.tags.join(", ")}` : ""} · {fm.status}{fm.event_date ? ` · ${fm.event_date}` : ""}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">Areas</p>
          <div className="flex flex-wrap gap-1.5">{AREAS.map((a) => <button key={a} onClick={() => toggleArr("areas", a)} className={chip(filters.areas.includes(a))}>{a}</button>)}</div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-gray-400">Gender
            <select value={filters.gender ?? ""} onChange={(e) => setFilters((f) => ({ ...f, gender: (e.target.value || undefined) as Filters["gender"] }))} className={inputCls}><option value="">Any</option><option value="M">M</option><option value="F">F</option></select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-gray-400">Local / Mehman
            <select value={filters.localMehman ?? ""} onChange={(e) => setFilters((f) => ({ ...f, localMehman: (e.target.value || undefined) as Filters["localMehman"] }))} className={inputCls}><option value="">Any</option><option value="Local">Local</option><option value="Mehman">Mehman</option></select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-gray-400">Age min
            <input type="number" min={0} value={filters.ageMin ?? ""} onChange={(e) => setFilters((f) => ({ ...f, ageMin: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className={`w-20 ${inputCls}`} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-gray-400">Age max
            <input type="number" min={0} value={filters.ageMax ?? ""} onChange={(e) => setFilters((f) => ({ ...f, ageMax: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className={`w-20 ${inputCls}`} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-gray-400">Sent from
            <input type="date" value={filters.dateFrom ?? ""} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-gray-400">Sent to
            <input type="date" value={filters.dateTo ?? ""} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined }))} className={inputCls} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={filters.rahatOnly} onChange={(e) => setFilters((f) => ({ ...f, rahatOnly: e.target.checked }))} className="accent-blue-600" /> Rahat / accessibility only</label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={filters.includeTest} onChange={(e) => setFilters((f) => ({ ...f, includeTest: e.target.checked }))} className="accent-blue-600" /> Include test submissions</label>
        </div>
        {(data?.options.jamaats.length ?? 0) > 0 && (
          <div>
            <p className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">Jamaat</p>
            <div className="flex max-h-20 flex-wrap gap-1.5 overflow-auto">{data!.options.jamaats.map((j) => <button key={j} onClick={() => toggleArr("jamaats", j)} className={chip(filters.jamaats.includes(j))}>{j}</button>)}</div>
          </div>
        )}
        {(data?.options.categories.length ?? 0) > 0 && (
          <div>
            <p className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">Category</p>
            <div className="flex flex-wrap gap-1.5">{data!.options.categories.map((c) => <button key={c} onClick={() => toggleArr("categories", c)} className={chip(filters.categories.includes(c))}>{c}</button>)}</div>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => load(filters)} disabled={loading} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{loading ? "Loading…" : "Apply filters"}</button>
          <button onClick={() => { setFilters(EMPTY); void load(EMPTY); }} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">Reset</button>
        </div>
      </div>

      {!data && <p className="text-sm text-gray-500 dark:text-gray-400">{loading ? "Loading analytics…" : "No data."}</p>}
      {data && o && (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: "Responded", value: o.responded, sub: "people who submitted" },
              { label: "Sent to", value: o.sent, sub: "people surveyed" },
              { label: "Response rate", value: `${Math.round(o.response_rate * 100)}%`, sub: `${o.responded} of ${o.sent}` },
              { label: "Avg sentiment", value: o.avg_sentiment != null ? `${o.avg_sentiment}/5` : "—", sub: "across scored answers" },
              { label: "Comments", value: o.comment_count, sub: "free-text / reasons" },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{c.value}</p>
                <p className="text-[11px] uppercase text-gray-500 dark:text-gray-400">{c.label}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Sentiment distribution */}
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Scored answers by sentiment</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">{o.scored_answers} scored answers · click a bar to see who · 1 = very negative → 5 = very positive</p>
            </div>
            <div className="flex items-end gap-2" style={{ height: 90 }}>
              {data.distribution.map((d) => {
                const pct = o.scored_answers ? Math.round((d.count / o.scored_answers) * 100) : 0;
                return (
                  <button
                    key={d.score}
                    type="button"
                    disabled={d.count === 0}
                    onClick={() => openDrill(d.score)}
                    title={d.count ? `See the ${d.count} who answered at ${d.score}/5` : "No answers at this score"}
                    className="flex flex-1 flex-col items-center justify-end gap-1 rounded enabled:hover:bg-gray-100 disabled:cursor-default dark:enabled:hover:bg-gray-800/60"
                  >
                    <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300">{d.count} <span className="text-gray-400">({pct}%)</span></span>
                    <div className={`w-full rounded-t ${d.score >= 4 ? "bg-emerald-600" : d.score === 3 ? "bg-amber-500" : "bg-red-600"}`} style={{ height: `${Math.max(d.count ? 3 : 0, (d.count / maxDist) * 60)}px` }} />
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{d.score}{d.score === 1 ? " ★" : d.score === 5 ? " ★★★★★" : ""}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Drill-down side pane: who answered what at the clicked score */}
          {drill && (
            <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setDrill(null)}>
              <div className="absolute inset-0 bg-black/40" />
              <div onClick={(e) => e.stopPropagation()} className="relative z-50 flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Answers scored {drill.score}/5</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{drill.loading ? "Loading…" : `${drill.rows.length} response${drill.rows.length === 1 ? "" : "s"} · current filters`}</p>
                  </div>
                  <button onClick={() => setDrill(null)} className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">✕</button>
                </div>
                <div className="flex-1 overflow-auto p-3">
                  {!drill.loading && drill.rows.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-400">No responses at this score for the active filters.</p>}
                  <ul className="space-y-2">
                    {drill.rows.map((r, i) => (
                      <li key={i} className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">{r.name ?? "—"}</span>
                          <span className="flex-shrink-0 font-mono text-[10px] text-gray-400">{r.its ?? ""}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-300">{r.question ?? r.section ?? "—"}</p>
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200">→ {r.answer ?? "—"}</p>
                        {r.reason && <p className="mt-0.5 text-[11px] italic text-amber-600 dark:text-amber-400">“{r.reason}”</p>}
                        <p className="mt-0.5 text-[10px] uppercase text-gray-400">{[r.section, r.area].filter(Boolean).join(" · ")}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* AI analysis */}
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase text-indigo-600 dark:text-indigo-400">AI analysis of comments ({o.comment_count})</p>
              <button onClick={runAi} disabled={aiBusy || !o.comment_count} className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{aiBusy ? "Analyzing…" : "Analyze with AI"}</button>
            </div>
            {aiErr && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{aiErr}</p>}
            {ai && (
              <div className="mt-2 space-y-2 text-sm">
                <p className="text-gray-800 dark:text-gray-100"><span className="font-semibold capitalize">{ai.overall_sentiment}</span> ({ai.sentiment_score_1_5}/5) — {ai.summary}</p>
                {ai.improvements?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Areas of improvement</p>
                    <ul className="mt-1 space-y-1">{ai.improvements.map((im, i) => (
                      <li key={i} className="text-xs text-gray-700 dark:text-gray-300"><span className={`font-semibold uppercase ${sevColor[im.severity] ?? ""}`}>[{im.severity}]</span> <span className="font-medium">{im.area}:</span> {im.suggestion}</li>
                    ))}</ul>
                  </div>
                )}
                {ai.themes?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Themes</p>
                    <ul className="mt-1 space-y-1">{ai.themes.map((t, i) => (
                      <li key={i} className="text-xs text-gray-700 dark:text-gray-300"><span className="font-medium">{t.theme}</span> · {t.sentiment} · {t.mentions} mentions <span className="italic text-gray-500 dark:text-gray-400">“{t.example}”</span></li>
                    ))}</ul>
                  </div>
                )}
                {ai.positives?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">What worked well</p>
                    <ul className="mt-1 list-disc pl-4 text-xs text-gray-700 dark:text-gray-300">{ai.positives.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
            {!ai && !aiBusy && !aiErr && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Run AI to summarize sentiment, recurring themes, and ranked areas of improvement from the filtered comments.</p>}
          </div>

          {/* Breakdowns */}
          <div className="grid gap-2 sm:grid-cols-2">
            <RowTable title="By section" rows={data.by_section} />
            <RowTable title="By area" rows={data.by_area} />
            <RowTable title="Local vs Mehman" rows={data.by_attribute.local_mehman} />
            <RowTable title="By gender" rows={data.by_attribute.gender} />
            <RowTable title="By age group" rows={data.by_attribute.age} />
            <RowTable title="Rahat vs general" rows={data.by_attribute.rahat} />
            <RowTable title="By jamaat (top)" rows={data.by_attribute.jamaat} />
          </div>

          {/* Sentiment trend by send-date (chronological) */}
          {(data.by_day?.length ?? 0) > 1 && (
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">By day (send date)</p>
              {data.by_day!.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="text-xs text-gray-700 dark:text-gray-300">{r.key} <span className="text-gray-400">({r.people} {r.people === 1 ? "person" : "people"} · {r.responses} answers)</span></span>
                  <Badge value={r.sentiment} />
                </div>
              ))}
            </div>
          )}

          {/* Per-question, grouped by section (sections ordered by their lowest-sentiment question) */}
          {data.by_question.length > 0 && (() => {
            const groups: { title: string; rows: QRow[] }[] = [];
            const idx = new Map<string, { title: string; rows: QRow[] }>();
            for (const q of data.by_question) {
              const key = q.section ?? "Other";
              let g = idx.get(key);
              if (!g) { g = { title: key, rows: [] }; idx.set(key, g); groups.push(g); }
              g.rows.push(q);
            }
            return (
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">By question · grouped by section (lowest sentiment first)</p>
                <div className="space-y-3">
                  {groups.map((g) => (
                    <div key={g.title}>
                      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">{g.title}</p>
                      <div className="space-y-2">
                        {g.rows.map((q) => (
                          <div key={q.question_id} className="border-t border-gray-100 pt-1.5 dark:border-gray-800">
                            <div className="flex items-start justify-between gap-3">
                              <span className="text-xs text-gray-700 dark:text-gray-300">{q.text} <span className="text-gray-400">({q.responses} answered)</span></span>
                              <Badge value={q.sentiment} />
                            </div>
                            {Object.keys(q.breakdown).length > 0 && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{Object.entries(q.breakdown).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Raw comments */}
          {data.comments.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Comments ({data.comments.length})</p>
              <ul className="max-h-80 space-y-1 overflow-auto">
                {data.comments.map((c, i) => (
                  <li key={i} className="border-t border-gray-100 py-1 text-xs dark:border-gray-800">
                    <span className="text-gray-700 dark:text-gray-300">{c.text}</span>
                    <span className="ml-1 text-[10px] uppercase text-gray-400">{[c.area, c.section].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
