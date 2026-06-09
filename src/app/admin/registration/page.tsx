"use client";

import { useRouter } from "next/navigation";
import React, { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { canViewRegistrations, isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type Analytics = {
  generated_at: string;
  filters: { local_mehman: string | null; status: string | null; attending: string | null };
  summary: {
    total_families: number;
    filtered_families: number;
    submitted_families: number;
    confirmed_families: number;
    pending_families: number;
    cancelled_families: number;
    total_mumineen: number;
    submitted_mumineen: number;
    pending_mumineen: number;
    attending: number;
    not_attending: number;
    local: number;
    mehman: number;
    adults: number;
    minors: number;
  };
  timeline: { date: string; count: number; cumulative: number }[];
  accommodation: {
    hotel: number;
    hotel_people: number;
    utaro: number;
    utaro_people: number;
    open_to_utaro: number;
    open_to_utaro_people: number;
    not_set: number;
    top_hotels: { name: string; count: number; people: number; awaiting: number; awaiting_people: number }[];
    hosts: { key: string; label: string; host_name: string; host_its: string | null; host_member_count: number; families: number; people: number }[];
  };
  transport: {
    rideshare: number; rideshare_people: number;
    rental: number; rental_people: number;
    commute_with_utaro: number; commute_with_utaro_people: number;
    other: number; other_people: number;
    not_set: number; not_set_people: number;
  };
  airports: { ORD: number; MDW: number; not_set: number };
  arrivals_by_date: { date: string; count: number }[];
  departures_by_date: { date: string; count: number }[];
  gender: { label: string; count: number }[];
  age_groups: {
    under_12: number;
    teen_12_17: number;
    adult_18_59: number;
    senior_60_plus: number;
    unknown: number;
  };
  khidmat: {
    wants: number;
    not_wants: number;
    not_set: number;
    by_department: { id: string; name: string; count: number }[];
  };
  accessibility: { rahat_seating: number; wheelchair: number; special_needs: number };
  data_quality: { no_full_name: number; no_local_mehman: number };
  missing_data: {
    no_whatsapp: number;
    no_email: number;
    no_arrival: number;
    no_airport: number;
    no_flight_no: number;
  };
};

type Filters = {
  local_mehman: "" | "Local" | "Mehman";
  status: "" | "submitted" | "pending" | "cancelled" | "confirmed";
  attending: "" | "true";
};

type DetailRow = {
  its: string;
  name: string;
  gender: string;
  age: string;
  local_mehman: string;
  whatsapp: string;
  email: string;
  detail: string;
  hof_its: string;
  head?: string;
  attending?: string;
  utaro_host_name?: string;
  utaro_host_its?: string;
  utaro_host_whatsapp?: string;
  utaro_host_email?: string;
  utaro_host_address?: string;
};

type DetailRequest = {
  segment: string;
  value?: string;
  label: string;
  detailLabel?: string; // column header for the detail field
};

// Page sections, in order — each maps to the team(s) it serves.
const SECTIONS = [
  { id: "overview", num: "01", label: "Overview" },
  { id: "mumineen", num: "02", label: "Mumineen" },
  { id: "accommodation", num: "03", label: "Accommodation" },
  { id: "travel", num: "04", label: "Transport & Travel" },
  { id: "khidmat", num: "05", label: "Khidmat" },
  { id: "estimates", num: "06", label: "Estimates" },
  { id: "followup", num: "07", label: "Follow-up" },
];

// ─── Estimates types ──────────────────────────────────────────────────────────

type EstimateSlice = {
  parking: {
    local_passes: number;
    mehman_rental_passes: number;
    local_over65_members: number;
    local_over65_families: number;
    total: number;
    rahat_analysis: {
      local_all_over65: number;
      mehman_over65_rental: number;
    };
  };
  thaals: {
    rahat_people: number;
    rahat_thaals: number;
    non_rahat_people: number;
    non_rahat_thaals: number;
    total_people: number;
    total_thaals: number;
    wheelchair_people: number;
  };
};

type Estimates = { current: EstimateSlice; forecast: EstimateSlice };

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  req,
  filters,
  onClose,
}: {
  req: DetailRequest;
  filters: Filters;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const params = new URLSearchParams({ segment: req.segment });
    if (req.value) params.set("value", req.value);
    if (filters.local_mehman) params.set("local_mehman", filters.local_mehman);
    if (filters.status) params.set("status", filters.status);
    if (filters.attending) params.set("attending", filters.attending);
    apiFetch(`/api/admin/registration-analytics/detail?${params}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [req.segment, req.value, filters]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = search.trim()
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.its.includes(search) ||
          r.whatsapp.includes(search) ||
          r.detail.toLowerCase().includes(search.toLowerCase()),
      )
    : rows;

  const hasDetail = rows.some((r) => r.detail);
  const showGender = rows.some((r) => r.gender !== "—");
  const showAge = rows.some((r) => r.age !== "—");
  const showHead = rows.some((r) => r.head !== undefined);
  const showAttending = rows.some((r) => r.attending !== undefined);
  // Columns spanned by the utaro host sub-row (kept in sync with the header below).
  const colCount =
    2 + (showGender ? 1 : 0) + (showAge ? 1 : 0) + 2 + (hasDetail ? 1 : 0) + (showHead ? 1 : 0) + (showAttending ? 1 : 0);

  function exportCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const withHead = filtered.some((r) => r.head !== undefined);
    const withAttending = filtered.some((r) => r.attending !== undefined);
    const header = ["Name", "ITS", "Gender", "Age", "Type", "Phone", "Email", req.detailLabel ?? "Details", "HOF ITS"];
    if (withHead) header.push("Head");
    if (withAttending) header.push("Attending");
    const lines = filtered.map((r) => {
      const cells = [r.name, r.its, r.gender, r.age, r.local_mehman, r.whatsapp, r.email, r.detail, r.hof_its];
      if (withHead) cells.push(r.head ?? "");
      if (withAttending) cells.push(r.attending ?? "");
      return cells.map(esc).join(",");
    });
    // Prepend a UTF-8 BOM so Excel (esp. on macOS) renders dashes/non-ASCII correctly instead of mojibake.
    const blob = new Blob(["\uFEFF" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${req.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div
        ref={panelRef}
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-gray-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{req.label}</h2>
            {!loading && (
              <p className="text-xs text-gray-500">{filtered.length} of {rows.length} shown</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              disabled={loading || filtered.length === 0}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <input
            type="search"
            placeholder="Search name, ITS, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-gray-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-gray-400">No results.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-2 py-2">ITS</th>
                  {showGender && <th className="px-2 py-2">G</th>}
                  {showAge && <th className="px-2 py-2">Age</th>}
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Phone</th>
                  {hasDetail && <th className="px-2 py-2">{req.detailLabel ?? "Details"}</th>}
                  {showHead && <th className="px-2 py-2">Head</th>}
                  {showAttending && <th className="px-2 py-2">Attending</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((r) => (
                  <React.Fragment key={r.its}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">
                        {r.name}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-gray-500">{r.its}</td>
                      {showGender && <td className="px-2 py-2 text-gray-500">{r.gender}</td>}
                      {showAge && <td className="px-2 py-2 text-gray-500">{r.age}</td>}
                      <td className="px-2 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.local_mehman === "Mehman" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                          : r.local_mehman === "Local" ? "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300"
                          : "bg-gray-100 text-gray-500"
                        }`}>
                          {r.local_mehman}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        {r.whatsapp ? (
                          <a href={`https://wa.me/${r.whatsapp.replace("+", "")}`} target="_blank" rel="noreferrer" className="text-green-600 hover:underline dark:text-green-400">
                            {r.whatsapp}
                          </a>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                      {hasDetail && (
                        <td className="max-w-xs px-2 py-2 text-gray-600 dark:text-gray-400">
                          {r.detail || "—"}
                        </td>
                      )}
                      {showHead && (
                        <td className="px-2 py-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                          {r.head || ""}
                        </td>
                      )}
                      {showAttending && (
                        <td className={`px-2 py-2 text-xs font-medium ${r.attending === "No" ? "text-red-500 dark:text-red-400" : "text-gray-500"}`}>
                          {r.attending}
                        </td>
                      )}
                    </tr>
                    {r.utaro_host_name && (
                      <tr key={`${r.its}-host`} className="bg-emerald-50/50 dark:bg-emerald-950/20">
                        <td colSpan={colCount} className="px-4 py-1.5">
                          <div className="flex flex-wrap items-center gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                            <span className="font-semibold">Host:</span>
                            <span>{r.utaro_host_name}</span>
                            {r.utaro_host_its && <span className="font-mono text-emerald-600 dark:text-emerald-400">{r.utaro_host_its}</span>}
                            {r.utaro_host_whatsapp && (
                              <a href={`https://wa.me/${r.utaro_host_whatsapp.replace("+", "")}`} target="_blank" rel="noreferrer" className="text-green-600 hover:underline dark:text-green-400">
                                {r.utaro_host_whatsapp}
                              </a>
                            )}
                            {r.utaro_host_email && <span className="text-emerald-600 dark:text-emerald-400">{r.utaro_host_email}</span>}
                            {r.utaro_host_address && <span className="text-emerald-500 dark:text-emerald-500">{r.utaro_host_address}</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
// ─── Chart primitives ─────────────────────────────────────────────────────────

function HBar({
  label,
  value,
  total,
  color = "bg-blue-500",
  onClick,
  trailing,
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      className={`flex items-center gap-3 py-1.5 ${
        onClick ? "cursor-pointer rounded-md px-1 hover:bg-gray-50 dark:hover:bg-gray-800/70" : ""
      }`}
    >
      <span className="w-36 shrink-0 truncate text-right text-sm text-gray-600 dark:text-gray-400">
        {label}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={`${color} h-2.5 rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-sm">
        <span className="font-semibold text-gray-900 dark:text-white">
          {value.toLocaleString()}
        </span>
        <span className="ml-1 text-xs text-gray-400">({Math.round(pct)}%)</span>
      </span>
      {trailing}
    </div>
  );
}

// Labeled mini-table of bars: label | bar | FAM | PPL | (AWAITING).
// A header row names every number; each row reserves every column, so the
// awaiting count is a real column and alignment never breaks.
type TableBarRow = {
  key: string;
  label: string;
  value: number;
  people: number | null; // null renders an em dash
  awaiting?: number;
  awaitingTitle?: string;
  color: string;
  onClick?: () => void;
  onAwaitingClick?: () => void;
};

function TableBars({
  rows,
  total,
  showAwaiting = false,
}: {
  rows: TableBarRow[];
  total: number; // denominator for the % shown next to the family count
  showAwaiting?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const cols = showAwaiting
    ? "grid-cols-[8.5rem_minmax(0,1fr)_4.5rem_3rem_4rem]"
    : "grid-cols-[8.5rem_minmax(0,1fr)_4.5rem_3rem]";
  return (
    <div>
      <div className={`grid items-center gap-x-2.5 border-b border-gray-100 pb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:border-gray-700 ${cols}`}>
        <span /><span />
        <span className="text-right">Fam</span>
        <span className="text-right">Ppl</span>
        {showAwaiting && <span className="text-right">Awaiting</span>}
      </div>
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.value / total) * 100) : 0;
        return (
          <div
            key={r.key}
            role={r.onClick ? "button" : undefined}
            tabIndex={r.onClick ? 0 : undefined}
            onClick={r.onClick}
            onKeyDown={r.onClick ? (e) => e.key === "Enter" && r.onClick?.() : undefined}
            className={`grid items-center gap-x-2.5 py-1.5 ${cols} ${
              r.onClick ? "cursor-pointer rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/70" : ""
            }`}
          >
            <span className="truncate text-right text-sm text-gray-600 dark:text-gray-400">{r.label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <div className={`${r.color} h-2.5 rounded-full transition-all duration-500`} style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
            <span className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
              {r.value.toLocaleString()}
              <span className="ml-1 text-[11px] font-normal text-gray-400">{pct}%</span>
            </span>
            <span className="text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">
              {r.people === null ? "—" : r.people.toLocaleString()}
            </span>
            {showAwaiting && (
              <span className="text-right">
                {r.awaiting && r.awaiting > 0 ? (
                  <button
                    type="button"
                    title={r.awaitingTitle}
                    onClick={(e) => { e.stopPropagation(); r.onAwaitingClick?.(); }}
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    {r.awaiting}
                  </button>
                ) : (
                  <span className="text-gray-200 dark:text-gray-700">—</span>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VBars({
  data,
  color = "bg-blue-500",
  height = 64,
  onBarClick,
}: {
  data: { date: string; count: number }[];
  color?: string;
  height?: number;
  onBarClick?: (date: string) => void;
}) {
  if (data.length === 0)
    return <p className="py-6 text-center text-sm text-gray-400">No data yet</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  const fmtDate = (d: string) => {
    const [, m, day] = d.split("-");
    return `${parseInt(m)}/${parseInt(day)}`;
  };
  return (
    <div className="mt-2 overflow-x-auto">
      <div className="flex min-w-0 items-end gap-0.5" style={{ height: `${height + 20}px` }}>
        {data.map((d) => (
          <div
            key={d.date}
            role={onBarClick ? "button" : undefined}
            tabIndex={onBarClick ? 0 : undefined}
            onClick={() => onBarClick?.(d.date)}
            onKeyDown={(e) => e.key === "Enter" && onBarClick?.(d.date)}
            className={`group relative flex flex-1 flex-col items-center justify-end ${onBarClick ? "cursor-pointer" : ""}`}
            style={{ height: `${height + 20}px` }}
          >
            <div
              className={`w-full min-h-[2px] ${color} rounded-t-sm opacity-75 transition-opacity group-hover:opacity-100`}
              style={{ height: `${(d.count / max) * height}px` }}
            />
            <div className="pointer-events-none absolute bottom-full mb-1 hidden rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block whitespace-nowrap">
              {fmtDate(d.date)}: {d.count}
            </div>
            {data.length <= 20 && (
              <span className="mt-0.5 text-[9px] text-gray-400 leading-none">
                {fmtDate(d.date)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  children,
  className = "",
  filterSlot,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  filterSlot?: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800/50 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {title}
        </h3>
        {filterSlot}
      </div>
      {children}
    </div>
  );
}

function InlineSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Layout primitives (section bands, KPI clusters, masonry) ─────────────────

// Band header: number, title, owning team chip, and section summary pills.
function SectionBand({
  id,
  num,
  title,
  team,
  pills,
  children,
}: {
  id: string;
  num: string;
  title: string;
  team: string;
  pills?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-16">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 pb-2.5 dark:border-gray-700">
        <span className="text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400">{num}</span>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        <span className="rounded-full border border-gray-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:border-gray-600 dark:text-gray-400">
          <span className="font-medium normal-case tracking-normal text-gray-400 dark:text-gray-500">for </span>
          {team}
        </span>
        {pills && <div className="ml-auto flex flex-wrap gap-2">{pills}</div>}
      </div>
      {children}
    </section>
  );
}

function Pill({ value, label, warn }: { value: string | number; label: string; warn?: boolean }) {
  return (
    <span
      className={`rounded-lg border px-2.5 py-1 text-xs ${
        warn
          ? "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
          : "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"
      }`}
    >
      <b className={`tabular-nums ${warn ? "" : "text-gray-900 dark:text-gray-100"}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </b>{" "}
      {label}
    </span>
  );
}

// Masonry packing: cards flow in columns and keep their natural height, so a
// tall card never stretches its neighbor (the empty-space fix).
function Masonry({ children }: { children: ReactNode }) {
  return <div className="columns-1 gap-4 pt-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">{children}</div>;
}

function KpiCluster({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 after:h-px after:flex-1 after:bg-gray-200 dark:text-gray-500 dark:after:bg-gray-700">
        {label}
      </div>
      <div className="grid auto-cols-fr grid-flow-col gap-2">{children}</div>
    </div>
  );
}

function Kpi({
  value,
  suffix,
  label,
  tone,
  onClick,
}: {
  value: number;
  suffix?: string;
  label: string;
  tone?: "highlight" | "warn";
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      className={`border-l-2 border-gray-200 px-2.5 py-0.5 dark:border-gray-700 ${
        onClick ? "cursor-pointer transition-colors hover:border-blue-500" : ""
      }`}
    >
      <p
        className={`text-2xl font-bold tabular-nums ${
          tone === "highlight"
            ? "text-blue-600 dark:text-blue-400"
            : tone === "warn"
              ? "text-red-500"
              : "text-gray-900 dark:text-white"
        }`}
      >
        {value.toLocaleString()}
        {suffix && <span className="ml-1 text-xs font-medium text-gray-400">{suffix}</span>}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      }`}
    >
      {label}
    </button>
  );
}

export default function RegistrationAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<Estimates | null>(null);

  const [filters, setFilters] = useState<Filters>({ local_mehman: "", status: "", attending: "" });
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  // KPI counts are open to every portal user; the per-person drill-down + CSV
  // export (ITS/name/phone/email) is admin/leadership only — matched by the
  // GET /api/admin/registration-analytics/detail gate.
  const [canDrill] = useState(() => isAdminOrLeadership(readAdminUser()));
  const [activeSection, setActiveSection] = useState("overview");

  // Section-level local filters
  const [hotelSearch, setHotelSearch] = useState("");
  const [airportFilter, setAirportFilter] = useState("");
  const [khidmatDeptFilter, setKhidmatDeptFilter] = useState("");


  const load = useCallback(
    async (f: Filters) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (f.local_mehman) params.set("local_mehman", f.local_mehman);
        if (f.status) params.set("status", f.status);
        if (f.attending) params.set("attending", f.attending);
        const url = `/api/admin/registration-analytics${params.toString() ? `?${params}` : ""}`;
        const res = await apiFetch(url);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        setData(json as Analytics);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const applyFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next);
  };

  const drill = (req: DetailRequest) => { if (canDrill) setDetail(req); };

  useEffect(() => {
    const user = readAdminUser();
    if (!user) { router.push("/admin/login"); return; }
    if (!canViewRegistrations(user)) { router.push("/admin/conversations"); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filters);
    apiFetch("/api/admin/registration-analytics/estimates")
      .then((r) => r.json())
      .then((d) => setEstimates(d as Estimates))
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Scroll-spy for the sticky section nav (sections exist only once data loads).
  useEffect(() => {
    if (!data) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActiveSection(e.target.id); });
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [data]);

  if (error)
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <p className="text-sm text-red-500">{error}</p>
        <button type="button" onClick={() => void load(filters)} className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm text-white">Retry</button>
      </main>
    );

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const activeFilterCount = [filters.local_mehman, filters.status, filters.attending].filter(Boolean).length;

  const summary = data?.summary;
  const regRate =
    summary && summary.filtered_families > 0
      ? Math.round((summary.submitted_families / summary.filtered_families) * 100) : 0;
  const mehmanPct =
    summary && summary.total_mumineen > 0
      ? Math.round((summary.mehman / summary.total_mumineen) * 100) : 0;
  const submittedMuminPct =
    summary && summary.total_mumineen > 0
      ? Math.round((summary.submitted_mumineen / summary.total_mumineen) * 100) : 0;

  const transportTotal = data
    ? data.transport.rideshare + data.transport.rental + data.transport.commute_with_utaro + data.transport.other + data.transport.not_set
    : 0;
  const airportTotal = data ? data.airports.ORD + data.airports.MDW + data.airports.not_set : 0;
  const missingTotal = data
    ? data.missing_data.no_whatsapp + data.missing_data.no_email + data.missing_data.no_arrival + data.missing_data.no_airport + data.missing_data.no_flight_no
    : 0;
  const dataQualityTotal = data ? data.data_quality.no_full_name + data.data_quality.no_local_mehman : 0;

  const filteredHotels = data
    ? hotelSearch
      ? data.accommodation.top_hotels.filter((h) => h.name.toLowerCase().includes(hotelSearch.toLowerCase()))
      : data.accommodation.top_hotels
    : [];

  const khidmatDepts = data
    ? khidmatDeptFilter
      ? data.khidmat.by_department.filter((d) => d.id === khidmatDeptFilter)
      : data.khidmat.by_department
    : [];

  return (
    <>
      {detail && (
        <DetailPanel
          req={detail}
          filters={filters}
          onClose={() => setDetail(null)}
        />
      )}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Registration Analytics</h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Live snapshot{canDrill ? " · click any bar or card to see individual records" : " · individual records & CSV export are admin/leadership only"}.
              {data?.generated_at && <span className="ml-2 text-gray-400">Updated {fmtDate(data.generated_at)}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(filters)}
            disabled={loading}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {/* ── Global filter bar ── */}
        <div className="mb-2 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Filters</span>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Type</span>
            <div className="flex gap-1">
              <Chip label="All" active={filters.local_mehman === ""} onClick={() => applyFilter({ local_mehman: "" })} />
              <Chip label="Local" active={filters.local_mehman === "Local"} onClick={() => applyFilter({ local_mehman: filters.local_mehman === "Local" ? "" : "Local" })} />
              <Chip label="Mehman" active={filters.local_mehman === "Mehman"} onClick={() => applyFilter({ local_mehman: filters.local_mehman === "Mehman" ? "" : "Mehman" })} />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Status</span>
            <div className="flex gap-1">
              <Chip label="All" active={filters.status === ""} onClick={() => applyFilter({ status: "" })} />
              <Chip label="Submitted" active={filters.status === "submitted"} onClick={() => applyFilter({ status: filters.status === "submitted" ? "" : "submitted" })} />
              <Chip label="Pending" active={filters.status === "pending"} onClick={() => applyFilter({ status: filters.status === "pending" ? "" : "pending" })} />
              <Chip label="Cancelled" active={filters.status === "cancelled"} onClick={() => applyFilter({ status: filters.status === "cancelled" ? "" : "cancelled" })} />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Attendance</span>
            <div className="flex gap-1">
              <Chip label="All" active={filters.attending === ""} onClick={() => applyFilter({ attending: "" })} />
              <Chip label="Attending only" active={filters.attending === "true"} onClick={() => applyFilter({ attending: filters.attending === "true" ? "" : "true" })} />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <button type="button" onClick={() => applyFilter({ local_mehman: "", status: "", attending: "" })} className="ml-auto text-xs text-red-500 hover:text-red-700">
              Clear all
            </button>
          )}
        </div>

        {/* ── Sticky section nav ── */}
        {data && (
          <nav className="sticky top-0 z-40 -mx-1 flex gap-1.5 overflow-x-auto bg-white/90 px-1 py-2.5 backdrop-blur dark:bg-gray-900/90">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  activeSection === s.id
                    ? "border-blue-500 bg-blue-50 text-gray-900 dark:bg-gray-800 dark:text-white"
                    : "border-gray-200 text-gray-500 hover:border-blue-400 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:text-white"
                }`}
              >
                <span className="text-[10px] font-bold tabular-nums text-blue-600 dark:text-blue-400">{s.num}</span>
                {s.label}
              </a>
            ))}
          </nav>
        )}

        {loading && !data && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800" />
            ))}
          </div>
        )}

        {data && summary && (
          <>
            {/* ════ 01 Overview ════ */}
            <section id="overview" className="scroll-mt-16">
              <div className="grid gap-3.5 lg:grid-cols-2">
                <KpiCluster label="Families · Registration Funnel">
                  <Kpi
                    value={summary.total_families}
                    label={activeFilterCount ? `${summary.filtered_families.toLocaleString()} in filter` : "total in roster"}
                  />
                  <Kpi
                    value={summary.submitted_families}
                    suffix={`${regRate}%`}
                    label="registered"
                    tone="highlight"
                    onClick={() => drill({ segment: "registration_status", value: "submitted", label: "Registered Families", detailLabel: "Submitted" })}
                  />
                  <Kpi
                    value={summary.pending_families}
                    label="pending submission"
                    onClick={() => drill({ segment: "registration_status", value: "pending", label: "Pending Families — Not Yet Submitted", detailLabel: "Status" })}
                  />
                </KpiCluster>
                <KpiCluster label="Mumineen · Registration Funnel">
                  <Kpi value={summary.total_mumineen} label="total in roster" />
                  <Kpi
                    value={summary.submitted_mumineen}
                    suffix={`${submittedMuminPct}%`}
                    label="from registered families"
                    tone="highlight"
                  />
                  <Kpi
                    value={summary.pending_mumineen}
                    label="pending submission"
                  />
                </KpiCluster>
              </div>
              <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
                <KpiCluster label="People · Headcount">
                  <Kpi
                    value={summary.attending}
                    label="attending (roster)"
                    onClick={() => drill({ segment: "attending", label: "Attending mumineen" })}
                  />
                  <Kpi
                    value={summary.not_attending}
                    label="not attending"
                    tone="warn"
                    onClick={() => drill({ segment: "not_attending", label: "Not Attending" })}
                  />
                  <Kpi
                    value={summary.mehman}
                    suffix={`${mehmanPct}%`}
                    label="mehman"
                    onClick={() => drill({ segment: "local_mehman", value: "Mehman", label: "Mehman (attending)" })}
                  />
                  <Kpi value={summary.local} label="local" onClick={() => drill({ segment: "local_mehman", value: "Local", label: "Local (attending)" })} />
                </KpiCluster>
              </div>

              <Masonry>
                <SectionCard title="Registration Status">
                  <div className="mb-4">
                    <div className="mb-1 flex justify-between text-xs text-gray-500">
                      <span>{summary.submitted_families} registered</span><span>{regRate}%</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                      <div className="h-3 rounded-full bg-green-500 transition-all duration-700" style={{ width: `${regRate}%` }} />
                    </div>
                  </div>
                  <p className="mb-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Families</p>
                  <HBar label="Submitted" value={summary.submitted_families} total={summary.filtered_families} color="bg-green-500" />
                  <HBar label="Pending" value={summary.pending_families} total={summary.filtered_families} color="bg-amber-400" />
                  {summary.confirmed_families > 0 && (
                    <HBar label="Confirmed" value={summary.confirmed_families} total={summary.filtered_families} color="bg-blue-500" />
                  )}
                  {summary.cancelled_families > 0 && (
                    <HBar label="Cancelled" value={summary.cancelled_families} total={summary.filtered_families} color="bg-red-400" />
                  )}
                  <p className="mb-1 mt-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Mumineen</p>
                  <HBar label="From registered" value={summary.submitted_mumineen} total={summary.total_mumineen} color="bg-green-500" />
                  <HBar label="Pending" value={summary.pending_mumineen} total={summary.total_mumineen} color="bg-amber-400" />
                </SectionCard>

                {data.timeline.length > 0 && (
                  <SectionCard title="Registrations Over Time">
                    <p className="mb-1 text-xs text-gray-400">Daily submissions</p>
                    <VBars data={data.timeline} color="bg-blue-500" height={64} />
                    <p className="mb-1 mt-4 text-xs text-gray-400">Cumulative ({summary.submitted_families} total)</p>
                    <VBars data={data.timeline.map((t) => ({ date: t.date, count: t.cumulative }))} color="bg-green-500" height={64} />
                  </SectionCard>
                )}
              </Masonry>
            </section>

            {/* ════ 02 Mumineen ════ */}
            <SectionBand
              id="mumineen"
              num="02"
              title="Mumineen"
              team="Mawaid · Flow"
              pills={
                <>
                  <Pill value={summary.attending} label="attending" />
                  <Pill value={data.accessibility.rahat_seating} label="rahat" />
                  <Pill value={data.accessibility.wheelchair} label="wheelchair" />
                </>
              }
            >
              <Masonry>
                <SectionCard title="Local vs Mehman · Gender">
                  <HBar label="Mehman" value={summary.mehman} total={summary.total_mumineen} color="bg-indigo-500" onClick={() => drill({ segment: "local_mehman", value: "Mehman", label: "Mehman (attending)" })} />
                  <HBar label="Local" value={summary.local} total={summary.total_mumineen} color="bg-teal-500" onClick={() => drill({ segment: "local_mehman", value: "Local", label: "Local (attending)" })} />
                  <div className="my-3 border-t border-gray-100 dark:border-gray-700" />
                  {data.gender.map((g) => (
                    <HBar key={g.label} label={g.label} value={g.count} total={summary.attending} color="bg-pink-400"
                      onClick={() => drill({ segment: "gender", value: g.label, label: `Gender: ${g.label}` })}
                    />
                  ))}
                </SectionCard>

                <SectionCard title="Age Groups (Attending)">
                  {([
                    { label: "Under 12", key: "age_group", value: "under_12", count: data.age_groups.under_12, color: "bg-yellow-400" },
                    { label: "Teen (12–17)", key: "age_group", value: "teen_12_17", count: data.age_groups.teen_12_17, color: "bg-orange-400" },
                    { label: "Adult (18–59)", key: "age_group", value: "adult_18_59", count: data.age_groups.adult_18_59, color: "bg-blue-500" },
                    { label: "Senior (60+)", key: "age_group", value: "senior_60_plus", count: data.age_groups.senior_60_plus, color: "bg-purple-500" },
                    ...(data.age_groups.unknown > 0 ? [{ label: "Age unknown", key: "age_group", value: "unknown", count: data.age_groups.unknown, color: "bg-gray-300" }] : []),
                  ] as const).map((row) => (
                    <HBar key={row.value} label={row.label} value={row.count} total={summary.attending} color={row.color}
                      onClick={() => drill({ segment: row.key, value: row.value, label: row.label })}
                    />
                  ))}
                </SectionCard>

                <SectionCard title="Accessibility Needs">
                  <div className="space-y-3">
                    {[
                      { label: "Rahat Seating", value: data.accessibility.rahat_seating, color: "bg-amber-400", desc: "Reserved or assisted seating in majlis", segment: "rahat_seating" },
                      { label: "Wheelchair", value: data.accessibility.wheelchair, color: "bg-orange-500", desc: "Needs wheelchair access or assistance", segment: "wheelchair" },
                      { label: "Special Needs", value: data.accessibility.special_needs, color: "bg-red-400", desc: "Dietary, medical, or mobility notes on file", segment: "special_needs" },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => drill({ segment: item.segment, label: item.label, detailLabel: item.segment === "special_needs" ? "Notes" : undefined })}
                        className="flex w-full items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-left hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50"
                      >
                        <div className={`mt-1 h-3 w-3 shrink-0 rounded-full ${item.color}`} />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                            {item.value.toLocaleString()} mumineen
                          </p>
                          <p className="text-xs text-gray-500">{item.label}</p>
                          <p className="text-xs text-gray-400">{item.desc}</p>
                        </div>
                        <span className="text-xs text-blue-500">View →</span>
                      </button>
                    ))}
                  </div>
                </SectionCard>
              </Masonry>
            </SectionBand>

            {/* ════ 03 Accommodation ════ */}
            <SectionBand
              id="accommodation"
              num="03"
              title="Accommodation"
              team="Accommodation"
              pills={
                <>
                  <Pill value={data.accommodation.hotel} label={`hotel · ${data.accommodation.hotel_people} ppl`} />
                  <Pill value={data.accommodation.utaro} label={`utaro · ${data.accommodation.utaro_people} ppl`} />
                  {data.accommodation.open_to_utaro > 0 && (
                    <Pill value={data.accommodation.open_to_utaro} label="awaiting utaro" warn />
                  )}
                </>
              }
            >
              {(() => {
                const accTotal = data.accommodation.hotel + data.accommodation.utaro + data.accommodation.not_set;
                return (
                  <div className="grid gap-4 pt-4 lg:grid-cols-2">
                    {/* Summary strip: bars left, awaiting call-to-action right */}
                    <SectionCard title="Summary" className="lg:col-span-2">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                        <div className="min-w-0 flex-1 lg:max-w-2xl">
                          <TableBars
                            total={accTotal}
                            rows={[
                              {
                                key: "hotel", label: "Hotel", value: data.accommodation.hotel, people: data.accommodation.hotel_people, color: "bg-blue-500",
                                onClick: () => drill({ segment: "hotel", label: "All Hotel Families", detailLabel: "Hotel" }),
                              },
                              {
                                key: "utaro", label: "Utaro / Host", value: data.accommodation.utaro, people: data.accommodation.utaro_people, color: "bg-emerald-500",
                                onClick: () => drill({ segment: "acc_type", value: "utaro", label: "Utaro / Host Families", detailLabel: "Accommodation" }),
                              },
                              {
                                key: "not_set", label: "Local (no acc.)", value: data.accommodation.not_set, people: null, color: "bg-gray-300",
                                onClick: () => drill({ segment: "acc_type", value: "", label: "Local Families — No Accommodation Needed", detailLabel: "Accommodation" }),
                              },
                            ]}
                          />
                        </div>
                        {data.accommodation.open_to_utaro > 0 && (
                          <button
                            type="button"
                            onClick={() => drill({ segment: "open_to_utaro", label: "Awaiting Utaro — hotel booked, open to a host", detailLabel: "Hotel" })}
                            className="flex shrink-0 flex-col items-start gap-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 hover:bg-amber-100 lg:w-72 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
                          >
                            <span>
                              <b className="text-base">{data.accommodation.open_to_utaro} {data.accommodation.open_to_utaro === 1 ? "family" : "families"}</b>{" "}
                              ({data.accommodation.open_to_utaro_people} people) awaiting utaro
                            </span>
                            <span className="text-xs">View list →</span>
                          </button>
                        )}
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="By Hotel"
                      filterSlot={
                        <input type="search" placeholder="Search hotels…" value={hotelSearch} onChange={(e) => setHotelSearch(e.target.value)}
                          className="w-36 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        />
                      }
                    >
                      {filteredHotels.length === 0 ? (
                        <p className="text-sm text-gray-400">{hotelSearch ? `No hotels match "${hotelSearch}".` : "No hotel registrations yet."}</p>
                      ) : (
                        <>
                          <TableBars
                            total={data.accommodation.hotel}
                            showAwaiting
                            rows={filteredHotels.map((h) => ({
                              key: h.name,
                              label: h.name,
                              value: h.count,
                              people: h.people,
                              awaiting: h.awaiting,
                              awaitingTitle: `${h.awaiting} families (${h.awaiting_people} people) at ${h.name} awaiting utaro`,
                              color: "bg-blue-400",
                              onClick: () => drill({ segment: "hotel", value: h.name, label: `${h.name} — families`, detailLabel: "Hotel" }),
                              onAwaitingClick: () => drill({ segment: "open_to_utaro", value: h.name, label: `${h.name} — awaiting utaro`, detailLabel: "Hotel" }),
                            }))}
                          />
                          <p className="mt-3 text-[11px] text-gray-400">
                            Amber count = families at this hotel open to utaro · click it to see just them
                          </p>
                        </>
                      )}
                    </SectionCard>

                    <SectionCard
                      title="Utaro Hosts"
                      filterSlot={
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">guest-reported</span>
                          {data.accommodation.hosts.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
                                const header = ["Host Name", "Host ITS", "Host Family Members", "FAM", "PPL"];
                                const sorted = [...data.accommodation.hosts].sort((a, b) => b.families - a.families);
                                const lines = sorted.map((h) =>
                                  [h.host_name, h.host_its ?? "", String(h.host_member_count), String(h.families), String(h.people)].map(esc).join(","),
                                );
                                const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = "utaro-hosts.csv";
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="rounded px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:ring-emerald-700 dark:hover:bg-emerald-950/40"
                            >
                              Export CSV
                            </button>
                          )}
                        </div>
                      }
                    >
                      {data.accommodation.hosts.length === 0 ? (
                        <p className="text-sm text-gray-400">No utaro registrations yet.</p>
                      ) : (
                        <>
                          <TableBars
                            total={data.accommodation.utaro}
                            rows={data.accommodation.hosts.slice(0, 10).map((h) => ({
                              key: h.key,
                              label: h.label,
                              value: h.families,
                              people: h.people,
                              color: "bg-emerald-400",
                              onClick: () => drill({ segment: "host", value: h.key, label: `${h.label} — guest families`, detailLabel: "Host" }),
                            }))}
                          />
                          {data.accommodation.hosts.length > 10 && (
                            <p className="mt-1 text-xs text-gray-400">Showing top 10 of {data.accommodation.hosts.length} hosts.</p>
                          )}
                        </>
                      )}
                    </SectionCard>
                  </div>
                );
              })()}
            </SectionBand>

            {/* ════ 04 Transport & Travel ════ */}
            <SectionBand
              id="travel"
              num="04"
              title="Transport & Travel"
              team="Transport · Parking · Reception"
              pills={
                <>
                  <Pill value={data.transport.rental} label="rentals" />
                  <Pill value={data.transport.rideshare} label="rideshare" />
                  <Pill value={data.airports.ORD} label="via ORD" />
                </>
              }
            >
              <Masonry>
                <SectionCard title="Daily Transport to Relay Center">
                  <HBar label="Rideshare" value={data.transport.rideshare} total={transportTotal} color="bg-violet-500"
                    onClick={() => drill({ segment: "transport", value: "rideshare", label: "Transport: Rideshare", detailLabel: "Transport" })}
                    trailing={<span className="w-16 shrink-0 text-right text-xs text-gray-400">{data.transport.rideshare_people.toLocaleString()} ppl</span>}
                  />
                  <HBar label="Rental Car" value={data.transport.rental} total={transportTotal} color="bg-orange-400"
                    onClick={() => drill({ segment: "transport", value: "rental", label: "Transport: Rental Car", detailLabel: "Transport" })}
                    trailing={<span className="w-16 shrink-0 text-right text-xs text-gray-400">{data.transport.rental_people.toLocaleString()} ppl</span>}
                  />
                  <HBar label="With Friends/Family" value={data.transport.commute_with_utaro} total={transportTotal} color="bg-teal-500"
                    onClick={() => drill({ segment: "transport", value: "commute_with_utaro", label: "Transport: With Friends/Family", detailLabel: "Transport" })}
                    trailing={<span className="w-16 shrink-0 text-right text-xs text-gray-400">{data.transport.commute_with_utaro_people.toLocaleString()} ppl</span>}
                  />
                  <HBar label="Other" value={data.transport.other} total={transportTotal} color="bg-gray-400"
                    onClick={() => drill({ segment: "transport", value: "other", label: "Transport: Other", detailLabel: "Transport" })}
                    trailing={<span className="w-16 shrink-0 text-right text-xs text-gray-400">{data.transport.other_people.toLocaleString()} ppl</span>}
                  />
                  {data.transport.not_set > 0 && (
                    <HBar label="Local" value={data.transport.not_set} total={transportTotal} color="bg-gray-200"
                      onClick={() => drill({ segment: "transport", value: "", label: "Local — No Transport Needed", detailLabel: "Transport" })}
                      trailing={<span className="w-16 shrink-0 text-right text-xs text-gray-400">{data.transport.not_set_people.toLocaleString()} ppl</span>}
                    />
                  )}
                </SectionCard>

                <SectionCard
                  title="Arrival Dates (Mehman)"
                  filterSlot={
                    <InlineSelect
                      value={airportFilter}
                      onChange={setAirportFilter}
                      options={[
                        { value: "", label: "All airports" },
                        { value: "ORD", label: "ORD — O'Hare" },
                        { value: "MDW", label: "MDW — Midway" },
                      ]}
                    />
                  }
                >
                  {data.arrivals_by_date.length === 0 ? (
                    <p className="text-sm text-gray-400">No arrival data yet</p>
                  ) : (
                    <>
                      <VBars
                        data={data.arrivals_by_date}
                        color="bg-blue-500"
                        height={80}
                        onBarClick={(date) =>
                          drill({ segment: "arrival_date", value: date, label: `Arrivals on ${date}`, detailLabel: "Arrival · Flight · Airport" })
                        }
                      />
                      <div className="mt-3">
                        <HBar label="ORD — O'Hare" value={data.airports.ORD} total={airportTotal} color="bg-blue-500"
                          onClick={() => drill({ segment: "airport", value: "ORD", label: "Flying into ORD (O'Hare)", detailLabel: "Arrival · Flight" })}
                        />
                        <HBar label="MDW — Midway" value={data.airports.MDW} total={airportTotal} color="bg-sky-400"
                          onClick={() => drill({ segment: "airport", value: "MDW", label: "Flying into MDW (Midway)", detailLabel: "Arrival · Flight" })}
                        />
                        {data.airports.not_set > 0 && (
                          <HBar label="Airport not set" value={data.airports.not_set} total={airportTotal} color="bg-gray-300"
                            onClick={() => drill({ segment: "airport", value: "not_set", label: "Mehman — No airport selected", detailLabel: "Arrival · Flight" })}
                          />
                        )}
                      </div>
                    </>
                  )}
                </SectionCard>

                <SectionCard title="Departure Dates (Mehman)">
                  {data.departures_by_date.length === 0 ? (
                    <p className="text-sm text-gray-400">No departure data yet</p>
                  ) : (
                    <VBars
                      data={data.departures_by_date}
                      color="bg-rose-400"
                      height={80}
                      onBarClick={(date) =>
                        drill({ segment: "departure_date", value: date, label: `Departures on ${date}`, detailLabel: "Departure date" })
                      }
                    />
                  )}
                </SectionCard>
              </Masonry>
            </SectionBand>

            {/* ════ 05 Khidmat ════ */}
            <SectionBand
              id="khidmat"
              num="05"
              title="Khidmat"
              team="HR · Volunteers"
              pills={<Pill value={data.khidmat.wants} label="interested" />}
            >
              <Masonry>
                <SectionCard title="Interest (Mehman Attending)">
                  {(() => {
                    const total = data.khidmat.wants + data.khidmat.not_wants + data.khidmat.not_set;
                    return (
                      <>
                        <HBar label="Interested" value={data.khidmat.wants} total={total} color="bg-green-500"
                          onClick={() => drill({ segment: "wants_khidmat", label: "Khidmat — Interested", detailLabel: "Departments" })}
                        />
                        <HBar label="Not interested" value={data.khidmat.not_wants} total={total} color="bg-red-400" />
                        {data.khidmat.not_set > 0 && (
                          <HBar label="Not answered" value={data.khidmat.not_set} total={total} color="bg-gray-300" />
                        )}
                      </>
                    );
                  })()}
                </SectionCard>

                {khidmatDepts.length > 0 && (
                  <SectionCard
                    title="By Department"
                    filterSlot={
                      <InlineSelect
                        value={khidmatDeptFilter}
                        onChange={setKhidmatDeptFilter}
                        options={[
                          { value: "", label: "All departments" },
                          ...data.khidmat.by_department.map((d) => ({ value: d.id, label: d.name })),
                        ]}
                      />
                    }
                  >
                    <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                      {khidmatDeptFilter ? "Selected department" : "Click a department to see who signed up"}
                    </p>
                    {khidmatDepts.map((d) => (
                      <HBar key={d.id} label={d.name} value={d.count} total={data.khidmat.wants} color="bg-green-400"
                        onClick={() => drill({ segment: "khidmat_dept", value: d.id, label: `Khidmat: ${d.name}`, detailLabel: "Departments" })}
                      />
                    ))}
                  </SectionCard>
                )}
              </Masonry>
            </SectionBand>

            {/* ════ 06 Estimates ════ */}
            <SectionBand
              id="estimates"
              num="06"
              title="Estimates"
              team="Logistics · Planning"
              pills={estimates ? (
                <>
                  <Pill value={estimates.forecast.parking.total} label="projected passes" />
                  <Pill value={estimates.forecast.thaals.total_thaals} label="projected thaals" />
                </>
              ) : undefined}
            >
              {!estimates ? (
                <p className="pt-4 text-sm text-gray-400">Loading estimates…</p>
              ) : (
                <Masonry>
                  {/* ── Parking Passes ── */}
                  <SectionCard title="Parking Passes">
                    <div className="mb-3 grid grid-cols-3 gap-x-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      <span />
                      <span className="text-right">Current</span>
                      <span className="text-right">Forecast</span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      {[
                        { label: "Local families", cur: estimates.current.parking.local_passes, fore: estimates.forecast.parking.local_passes, note: "" },
                        { label: "Mehman rental car", cur: estimates.current.parking.mehman_rental_passes, fore: estimates.forecast.parking.mehman_rental_passes, note: "extrapolated from registration rate" },
                      ].map((row) => (
                        <div key={row.label} className="grid grid-cols-3 gap-x-3">
                          <span className="text-gray-600 dark:text-gray-400">
                            {row.label}
                            {row.note && <span className="ml-1 block text-[10px] text-gray-400">{row.note}</span>}
                          </span>
                          <span className="text-right tabular-nums text-gray-800 dark:text-gray-200">{row.cur.toLocaleString()}</span>
                          <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{row.fore.toLocaleString()}</span>
                        </div>
                      ))}
                      <div className="grid grid-cols-3 gap-x-3">
                        <span className="text-gray-600 dark:text-gray-400">
                          Drop-off passes (local 65+)
                          <span className="block text-[10px] text-gray-400">families with at least one member &gt; 65</span>
                        </span>
                        <span className="text-right tabular-nums text-gray-800 dark:text-gray-200">
                          {estimates.current.parking.local_over65_families.toLocaleString()}
                          <span className="block text-[10px] text-gray-400">{estimates.current.parking.local_over65_members.toLocaleString()} indv</span>
                        </span>
                        <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {estimates.forecast.parking.local_over65_families.toLocaleString()}
                          <span className="block text-[10px] text-gray-400">{estimates.forecast.parking.local_over65_members.toLocaleString()} indv</span>
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-x-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                        <span className="font-semibold text-gray-900 dark:text-white">Total passes</span>
                        <span className="text-right text-lg font-bold tabular-nums text-blue-600 dark:text-blue-400">{estimates.current.parking.total.toLocaleString()}</span>
                        <span className="text-right text-lg font-bold tabular-nums text-gray-500 dark:text-gray-400">{estimates.forecast.parking.total.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Rahat analysis */}
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-950/20">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        Rahat Pass Analysis
                      </p>
                      <div className="mb-1 grid grid-cols-3 gap-x-3 text-xs font-semibold uppercase tracking-wide text-amber-600/70 dark:text-amber-500/70">
                        <span />
                        <span className="text-right">Current</span>
                        <span className="text-right">Forecast</span>
                      </div>
                      <div className="space-y-1.5 text-sm">
                        {[
                          {
                            label: "Local families — all members > 65",
                            cur: estimates.current.parking.rahat_analysis.local_all_over65,
                            fore: estimates.forecast.parking.rahat_analysis.local_all_over65,
                          },
                          {
                            label: "Mehman families — over 65 + rental",
                            cur: estimates.current.parking.rahat_analysis.mehman_over65_rental,
                            fore: estimates.forecast.parking.rahat_analysis.mehman_over65_rental,
                          },
                        ].map((row) => (
                          <div key={row.label} className="grid grid-cols-3 gap-x-3">
                            <span className="text-amber-800 dark:text-amber-300">{row.label}</span>
                            <span className="text-right tabular-nums text-amber-900 dark:text-amber-200">{row.cur.toLocaleString()}</span>
                            <span className="text-right tabular-nums text-amber-700 dark:text-amber-400">{row.fore.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </SectionCard>

                  {/* ── Mawaid Thaals ── */}
                  <SectionCard title="Mawaid Thaals (÷ 8)">
                    <div className="mb-3 grid grid-cols-3 gap-x-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      <span />
                      <span className="text-right">Current</span>
                      <span className="text-right">Forecast</span>
                    </div>
                    <div className="space-y-3 text-sm">
                      {/* Rahat block */}
                      <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/20">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Rahat</p>
                        <div className="space-y-1">
                          {[
                            { label: "People", cur: estimates.current.thaals.rahat_people, fore: estimates.forecast.thaals.rahat_people },
                            { label: "Thaals", cur: estimates.current.thaals.rahat_thaals, fore: estimates.forecast.thaals.rahat_thaals, bold: true },
                          ].map((row) => (
                            <div key={row.label} className={`grid grid-cols-3 gap-x-3 ${row.bold ? "font-semibold" : ""}`}>
                              <span className="text-emerald-800 dark:text-emerald-300">{row.label}</span>
                              <span className="text-right tabular-nums text-emerald-900 dark:text-emerald-200">{row.cur.toLocaleString()}</span>
                              <span className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{row.fore.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Non-rahat block */}
                      <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Non-Rahat</p>
                        <div className="space-y-1">
                          {[
                            { label: "People", cur: estimates.current.thaals.non_rahat_people, fore: estimates.forecast.thaals.non_rahat_people },
                            { label: "Thaals", cur: estimates.current.thaals.non_rahat_thaals, fore: estimates.forecast.thaals.non_rahat_thaals, bold: true },
                          ].map((row) => (
                            <div key={row.label} className={`grid grid-cols-3 gap-x-3 ${row.bold ? "font-semibold" : ""}`}>
                              <span className="text-gray-600 dark:text-gray-400">{row.label}</span>
                              <span className="text-right tabular-nums text-gray-800 dark:text-gray-200">{row.cur.toLocaleString()}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{row.fore.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Total */}
                      <div className="grid grid-cols-3 gap-x-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                        <span className="font-semibold text-gray-900 dark:text-white">Total thaals</span>
                        <span className="text-right text-lg font-bold tabular-nums text-blue-600 dark:text-blue-400">{estimates.current.thaals.total_thaals.toLocaleString()}</span>
                        <span className="text-right text-lg font-bold tabular-nums text-gray-500 dark:text-gray-400">{estimates.forecast.thaals.total_thaals.toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {estimates.current.thaals.total_people.toLocaleString()} attending now ·{" "}
                        {estimates.forecast.thaals.total_people.toLocaleString()} projected ·{" "}
                        {estimates.current.thaals.wheelchair_people} wheelchair (current)
                      </p>
                    </div>
                  </SectionCard>
                </Masonry>
              )}
            </SectionBand>

            {/* ════ 07 Follow-up ════ */}
            <SectionBand
              id="followup"
              num="07"
              title="Data Follow-up"
              team="Follow-up · IT"
              pills={<Pill value={missingTotal + dataQualityTotal} label="records need follow-up" warn={missingTotal + dataQualityTotal > 0} />}
            >
              <Masonry>
                <SectionCard title="Missing Data (Submitted Registrations)">
                  {missingTotal === 0 ? (
                    <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
                      All submitted registrations are complete.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="mb-3 text-xs text-gray-400">Click any row to see who needs follow-up.</p>
                      {[
                        { label: "No WhatsApp number", value: data.missing_data.no_whatsapp, urgent: true, segment: "missing_whatsapp" },
                        { label: "No email", value: data.missing_data.no_email, urgent: false, segment: "missing_email" },
                        { label: "No arrival date (Mehman)", value: data.missing_data.no_arrival, urgent: false, segment: "missing_arrival" },
                        { label: "No airport selected (Mehman)", value: data.missing_data.no_airport, urgent: false, segment: "missing_airport" },
                        { label: "No flight number (Mehman)", value: data.missing_data.no_flight_no, urgent: false, segment: "missing_flight" },
                      ]
                        .filter((item) => item.value > 0)
                        .map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => drill({ segment: item.segment, label: item.label })}
                            className={`flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-sm hover:opacity-80 ${
                              item.urgent
                                ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                                : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                            }`}
                          >
                            <span>{item.label}</span>
                            <span className="font-semibold">{item.value.toLocaleString()} →</span>
                          </button>
                        ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Roster Data Quality">
                  <p className="mb-3 text-xs text-gray-400">
                    Gaps in the imported roster — not from registration. Re-import with corrected data to fix.
                  </p>
                  {dataQualityTotal === 0 ? (
                    <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
                      All clear — no roster gaps.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data.data_quality.no_full_name > 0 && (
                        <button
                          type="button"
                          onClick={() => drill({ segment: "no_full_name", label: "Roster entries with no name" })}
                          className="flex w-full items-center justify-between rounded-lg bg-orange-50 px-4 py-2.5 text-sm text-orange-800 hover:opacity-80 dark:bg-orange-950/30 dark:text-orange-300"
                        >
                          <span>No full name in roster</span>
                          <span className="font-semibold">{data.data_quality.no_full_name.toLocaleString()} →</span>
                        </button>
                      )}
                      {data.data_quality.no_local_mehman > 0 && (
                        <button
                          type="button"
                          onClick={() => drill({ segment: "no_local_mehman", label: "Roster entries with no Local/Mehman classification" })}
                          className="flex w-full items-center justify-between rounded-lg bg-orange-50 px-4 py-2.5 text-sm text-orange-800 hover:opacity-80 dark:bg-orange-950/30 dark:text-orange-300"
                        >
                          <span>No Local / Mehman classification</span>
                          <span className="font-semibold">{data.data_quality.no_local_mehman.toLocaleString()} →</span>
                        </button>
                      )}
                    </div>
                  )}
                </SectionCard>
              </Masonry>
            </SectionBand>
          </>
        )}
      </main>
    </>
  );
}
