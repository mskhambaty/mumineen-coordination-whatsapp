"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { canViewRegistrations } from "@/lib/admin/access";

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
    utaro: number;
    open_to_utaro: number;
    not_set: number;
    top_hotels: { name: string; count: number }[];
  };
  transport: {
    rideshare: number;
    rental: number;
    commute_with_utaro: number;
    other: number;
    not_set: number;
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
};

type DetailRequest = {
  segment: string;
  value?: string;
  label: string;
  detailLabel?: string; // column header for the detail field
};

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  req,
  filters,
  adminKey,
  onClose,
}: {
  req: DetailRequest;
  filters: Filters;
  adminKey: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ segment: req.segment });
    if (req.value) params.set("value", req.value);
    if (filters.local_mehman) params.set("local_mehman", filters.local_mehman);
    if (filters.status) params.set("status", filters.status);
    if (filters.attending) params.set("attending", filters.attending);
    fetch(`/api/admin/registration-analytics/detail?${params}`, {
      headers: { "x-admin-key": adminKey },
    })
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [req.segment, req.value, filters, adminKey]);

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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((r) => (
                  <tr key={r.its} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">
                      {r.name}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-gray-500">{r.its}</td>
                    {showGender && (
                      <td className="px-2 py-2 text-gray-500">{r.gender}</td>
                    )}
                    {showAge && (
                      <td className="px-2 py-2 text-gray-500">{r.age}</td>
                    )}
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.local_mehman === "Mehman"
                            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                            : r.local_mehman === "Local"
                            ? "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {r.local_mehman}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {r.whatsapp ? (
                        <a
                          href={`https://wa.me/${r.whatsapp.replace("+", "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-green-600 hover:underline dark:text-green-400"
                        >
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
                  </tr>
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

function StatCard({
  label,
  value,
  sub,
  highlight,
  onClick,
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      className={`rounded-xl border p-4 transition-shadow ${
        onClick ? "cursor-pointer hover:shadow-md" : ""
      } ${
        highlight
          ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40"
          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`mt-1 text-3xl font-bold tabular-nums ${
          highlight ? "text-blue-700 dark:text-blue-300" : "text-gray-900 dark:text-white"
        }`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p>}
      {onClick && (
        <p className="mt-1 text-xs text-blue-500 dark:text-blue-400">Click to view →</p>
      )}
    </div>
  );
}

function HBar({
  label,
  value,
  total,
  color = "bg-blue-500",
  onClick,
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
  onClick?: () => void;
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function RegistrationAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({ local_mehman: "", status: "", attending: "" });
  const [detail, setDetail] = useState<DetailRequest | null>(null);

  // Section-level local filters
  const [hotelSearch, setHotelSearch] = useState("");
  const [airportFilter, setAirportFilter] = useState("");
  const [khidmatDeptFilter, setKhidmatDeptFilter] = useState("");

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

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
        const res = await fetch(url, { headers: { "x-admin-key": adminKey } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        setData(json as Analytics);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [adminKey],
  );

  const applyFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next);
  };

  const drill = (req: DetailRequest) => setDetail(req);

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) { router.push("/admin/login"); return; }
    const raw = localStorage.getItem("admin_user");
    const user = raw ? JSON.parse(raw) : null;
    if (!canViewRegistrations(user)) { router.push("/admin/conversations"); return; }
    void load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (error)
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <p className="text-sm text-red-500">{error}</p>
        <button type="button" onClick={() => void load(filters)} className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm text-white">Retry</button>
      </main>
    );

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const Chip = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
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

  const activeFilterCount = [filters.local_mehman, filters.status, filters.attending].filter(Boolean).length;

  const summary = data?.summary;
  const regRate =
    summary && summary.total_families > 0
      ? Math.round((summary.submitted_families / summary.total_families) * 100) : 0;

  const transportTotal = data
    ? data.transport.rideshare + data.transport.rental + data.transport.commute_with_utaro + data.transport.other + data.transport.not_set
    : 0;
  const airportTotal = data ? data.airports.ORD + data.airports.MDW + data.airports.not_set : 0;
  const missingTotal = data
    ? data.missing_data.no_whatsapp + data.missing_data.no_email + data.missing_data.no_arrival + data.missing_data.no_airport + data.missing_data.no_flight_no
    : 0;

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
          adminKey={adminKey}
          onClose={() => setDetail(null)}
        />
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Registration Analytics</h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Live snapshot · click any bar or card to see individual records.
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
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
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

        {loading && !data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800" />
            ))}
          </div>
        )}

        {data && summary && (
          <>
            {/* ── Stat strip ── */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Total Families" value={summary.total_families} sub={activeFilterCount ? `${summary.filtered_families} in filter` : "in roster"} />
              <StatCard
                label="Registered"
                value={summary.submitted_families}
                sub={`${regRate}% complete`}
                highlight
                onClick={() => drill({ segment: "registration_status", value: "submitted", label: "Registered Families", detailLabel: "Submitted" })}
              />
              <StatCard
                label="Pending"
                value={summary.pending_families}
                sub="not yet submitted"
                onClick={() => drill({ segment: "registration_status", value: "pending", label: "Pending Families — Not Yet Submitted", detailLabel: "Status" })}
              />
              <StatCard label="Total Mumineen" value={summary.total_mumineen} />
              <StatCard
                label="Attending"
                value={summary.attending}
                sub={`${summary.not_attending} not attending`}
                onClick={() => drill({ segment: "attending", label: "Attending mumineen" })}
              />
              <StatCard
                label="Not Attending"
                value={summary.not_attending}
                onClick={() => drill({ segment: "not_attending", label: "Not Attending" })}
              />
            </div>

            {/* ── Row 1 ── */}
            <div className="mb-4 grid gap-4 lg:grid-cols-3">
              <SectionCard title="Registration Status">
                <div className="mb-4">
                  <div className="mb-1 flex justify-between text-xs text-gray-500">
                    <span>{summary.submitted_families} registered</span><span>{regRate}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div className="h-3 rounded-full bg-green-500 transition-all duration-700" style={{ width: `${regRate}%` }} />
                  </div>
                </div>
                <HBar label="Submitted" value={summary.submitted_families} total={summary.total_families} color="bg-green-500" />
                <HBar label="Pending" value={summary.pending_families} total={summary.total_families} color="bg-amber-400" />
                {summary.confirmed_families > 0 && (
                  <HBar label="Confirmed" value={summary.confirmed_families} total={summary.total_families} color="bg-blue-500" />
                )}
                {summary.cancelled_families > 0 && (
                  <HBar label="Cancelled" value={summary.cancelled_families} total={summary.total_families} color="bg-red-400" />
                )}
              </SectionCard>

              <SectionCard title="Attendance">
                <HBar label="Attending" value={summary.attending} total={summary.total_mumineen} color="bg-green-500" onClick={() => drill({ segment: "attending", label: "Attending mumineen" })} />
                <HBar label="Not Attending" value={summary.not_attending} total={summary.total_mumineen} color="bg-red-400" onClick={() => drill({ segment: "not_attending", label: "Not Attending" })} />
                <div className="my-3 border-t border-gray-100 dark:border-gray-700" />
                <HBar label="Adults" value={summary.adults} total={summary.total_mumineen} color="bg-blue-500" onClick={() => drill({ segment: "age_group", value: "adult_18_59", label: "Adults (18–59)" })} />
                <HBar label="Minors" value={summary.minors} total={summary.total_mumineen} color="bg-purple-400" onClick={() => drill({ segment: "age_group", value: "under_12", label: "Minors" })} />
              </SectionCard>

              <SectionCard title="Local vs Mehman">
                <HBar label="Mehman" value={summary.mehman} total={summary.total_mumineen} color="bg-indigo-500" onClick={() => drill({ segment: "attending", label: "Mehman (attending)", })} />
                <HBar label="Local" value={summary.local} total={summary.total_mumineen} color="bg-teal-500" onClick={() => drill({ segment: "attending", label: "Local (attending)" })} />
                <div className="my-3 border-t border-gray-100 dark:border-gray-700" />
                {data.gender.map((g) => (
                  <HBar key={g.label} label={g.label} value={g.count} total={summary.attending} color="bg-pink-400"
                    onClick={() => drill({ segment: "gender", value: g.label, label: `Gender: ${g.label}` })}
                  />
                ))}
              </SectionCard>
            </div>

            {/* ── Timeline ── */}
            {data.timeline.length > 0 && (
              <SectionCard title="Registrations Over Time" className="mb-4">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs text-gray-400">Daily submissions</p>
                    <VBars data={data.timeline} color="bg-blue-500" height={80} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-gray-400">Cumulative ({summary.submitted_families} total)</p>
                    <VBars data={data.timeline.map((t) => ({ date: t.date, count: t.cumulative }))} color="bg-green-500" height={80} />
                  </div>
                </div>
              </SectionCard>
            )}

            {/* ── Accommodation | Transport ── */}
            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              <SectionCard
                title="Accommodation"
                filterSlot={
                  <input type="search" placeholder="Search hotels…" value={hotelSearch} onChange={(e) => setHotelSearch(e.target.value)}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 w-36"
                  />
                }
              >
                {(() => {
                  const total = data.accommodation.hotel + data.accommodation.utaro + data.accommodation.not_set;
                  return (
                    <>
                      <HBar label="Hotel" value={data.accommodation.hotel} total={total} color="bg-blue-500"
                        onClick={() => drill({ segment: "hotel", label: "All Hotel Families", detailLabel: "Hotel" })}
                      />
                      <HBar label="Utaro / Host" value={data.accommodation.utaro} total={total} color="bg-emerald-500"
                        onClick={() => drill({ segment: "acc_type", value: "utaro", label: "Utaro / Host Families", detailLabel: "Accommodation" })}
                      />
                      {data.accommodation.not_set > 0 && (
                        <HBar label="Not set" value={data.accommodation.not_set} total={total} color="bg-gray-300"
                          onClick={() => drill({ segment: "acc_type", value: "", label: "Families — Accommodation Not Set" })}
                        />
                      )}
                      {data.accommodation.open_to_utaro > 0 && (
                        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                          {data.accommodation.open_to_utaro}{" "}
                          {data.accommodation.open_to_utaro === 1 ? "family" : "families"} open to utaro
                        </p>
                      )}
                      {filteredHotels.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                            {hotelSearch ? `Matching "${hotelSearch}"` : "Top hotels — click to see who's staying there"}
                          </p>
                          {filteredHotels.map((h) => (
                            <HBar key={h.name} label={h.name} value={h.count} total={data.accommodation.hotel} color="bg-blue-400"
                              onClick={() => drill({ segment: "hotel", value: h.name, label: `${h.name} — families`, detailLabel: "Hotel" })}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </SectionCard>

              <SectionCard title="Daily Transport to Relay Center">
                <HBar label="Rideshare" value={data.transport.rideshare} total={transportTotal} color="bg-violet-500"
                  onClick={() => drill({ segment: "transport", value: "rideshare", label: "Transport: Rideshare", detailLabel: "Transport" })}
                />
                <HBar label="Rental Car" value={data.transport.rental} total={transportTotal} color="bg-orange-400"
                  onClick={() => drill({ segment: "transport", value: "rental", label: "Transport: Rental Car", detailLabel: "Transport" })}
                />
                <HBar label="With Friends/Family" value={data.transport.commute_with_utaro} total={transportTotal} color="bg-teal-500"
                  onClick={() => drill({ segment: "transport", value: "commute_with_utaro", label: "Transport: With Friends/Family", detailLabel: "Transport" })}
                />
                <HBar label="Other" value={data.transport.other} total={transportTotal} color="bg-gray-400"
                  onClick={() => drill({ segment: "transport", value: "other", label: "Transport: Other", detailLabel: "Transport" })}
                />
                {data.transport.not_set > 0 && (
                  <HBar label="Not set" value={data.transport.not_set} total={transportTotal} color="bg-gray-200"
                    onClick={() => drill({ segment: "transport", value: "", label: "Transport: Not Set", detailLabel: "Transport" })}
                  />
                )}
              </SectionCard>
            </div>

            {/* ── Arrivals | Departures ── */}
            <div className="mb-4 grid gap-4 lg:grid-cols-2">
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
            </div>

            {/* ── Age groups | Khidmat ── */}
            <div className="mb-4 grid gap-4 lg:grid-cols-2">
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

              <SectionCard
                title="Khidmat Interest (Mehman Attending)"
                filterSlot={
                  data.khidmat.by_department.length > 0 ? (
                    <InlineSelect
                      value={khidmatDeptFilter}
                      onChange={setKhidmatDeptFilter}
                      options={[
                        { value: "", label: "All departments" },
                        ...data.khidmat.by_department.map((d) => ({ value: d.id, label: d.name })),
                      ]}
                    />
                  ) : undefined
                }
              >
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
                      {khidmatDepts.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                            {khidmatDeptFilter ? "Selected department" : "By department — click to see who signed up"}
                          </p>
                          {khidmatDepts.map((d) => (
                            <HBar key={d.id} label={d.name} value={d.count} total={data.khidmat.wants} color="bg-green-400"
                              onClick={() => drill({ segment: "khidmat_dept", value: d.id, label: `Khidmat: ${d.name}`, detailLabel: "Departments" })}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </SectionCard>
            </div>

            {/* ── Accessibility | Missing data ── */}
            <div className="mb-4 grid gap-4 lg:grid-cols-2">
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
            </div>
          </>
        )}
      </main>
    </>
  );
}
