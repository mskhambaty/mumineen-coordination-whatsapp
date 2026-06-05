"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { canAccessMumineen } from "@/lib/admin/access";

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

// ─── Reusable chart primitives ─────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
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
      {sub && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p>
      )}
    </div>
  );
}

function HBar({
  label,
  value,
  total,
  color = "bg-blue-500",
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
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
}: {
  data: { date: string; count: number }[];
  color?: string;
  height?: number;
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
            className="group relative flex flex-1 flex-col items-center justify-end"
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

// A small inline select used as a per-section filter
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

  // Global filters (affect API call)
  const [filters, setFilters] = useState<Filters>({
    local_mehman: "",
    status: "",
    attending: "",
  });

  // Section-level local filters (purely client-side; don't re-fetch)
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

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) { router.push("/admin/login"); return; }
    const raw = localStorage.getItem("admin_user");
    const user = raw ? JSON.parse(raw) : null;
    if (!canAccessMumineen(user)) { router.push("/admin/conversations"); return; }
    void load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (error)
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <p className="text-sm text-red-500">{error}</p>
        <button
          type="button"
          onClick={() => void load(filters)}
          className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </main>
    );

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // Pill button for filter chips
  const Chip = ({
    label,
    active,
    onClick,
  }: {
    label: string;
    active: boolean;
    onClick: () => void;
  }) => (
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
      ? Math.round((summary.submitted_families / summary.total_families) * 100)
      : 0;

  const transportTotal = data
    ? data.transport.rideshare +
      data.transport.rental +
      data.transport.commute_with_utaro +
      data.transport.other +
      data.transport.not_set
    : 0;
  const airportTotal = data ? data.airports.ORD + data.airports.MDW + data.airports.not_set : 0;

  const missingTotal = data
    ? data.missing_data.no_whatsapp +
      data.missing_data.no_email +
      data.missing_data.no_arrival +
      data.missing_data.no_airport +
      data.missing_data.no_flight_no
    : 0;

  // Section-level filtered data (client-side only, no re-fetch)
  const filteredHotels = data
    ? hotelSearch
      ? data.accommodation.top_hotels.filter((h) =>
          h.name.toLowerCase().includes(hotelSearch.toLowerCase()),
        )
      : data.accommodation.top_hotels
    : [];

  const arrivals = data
    ? airportFilter
      ? [] // can't filter arrivals by airport without raw data — show note
      : data.arrivals_by_date
    : [];

  const khidmatDepts = data
    ? khidmatDeptFilter
      ? data.khidmat.by_department.filter((d) => d.id === khidmatDeptFilter)
      : data.khidmat.by_department
    : [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Registration Analytics
          </h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Live snapshot of all mumineen registration data.
            {data?.generated_at && (
              <span className="ml-2 text-gray-400">Updated {fmtDate(data.generated_at)}</span>
            )}
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
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Filters
        </span>

        {/* Local / Mehman */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">Type</span>
          <div className="flex gap-1">
            <Chip
              label="All"
              active={filters.local_mehman === ""}
              onClick={() => applyFilter({ local_mehman: "" })}
            />
            <Chip
              label="Local"
              active={filters.local_mehman === "Local"}
              onClick={() => applyFilter({ local_mehman: filters.local_mehman === "Local" ? "" : "Local" })}
            />
            <Chip
              label="Mehman"
              active={filters.local_mehman === "Mehman"}
              onClick={() => applyFilter({ local_mehman: filters.local_mehman === "Mehman" ? "" : "Mehman" })}
            />
          </div>
        </div>

        {/* Registration status */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">Status</span>
          <div className="flex gap-1">
            <Chip
              label="All"
              active={filters.status === ""}
              onClick={() => applyFilter({ status: "" })}
            />
            <Chip
              label="Submitted"
              active={filters.status === "submitted"}
              onClick={() => applyFilter({ status: filters.status === "submitted" ? "" : "submitted" })}
            />
            <Chip
              label="Pending"
              active={filters.status === "pending"}
              onClick={() => applyFilter({ status: filters.status === "pending" ? "" : "pending" })}
            />
            <Chip
              label="Cancelled"
              active={filters.status === "cancelled"}
              onClick={() => applyFilter({ status: filters.status === "cancelled" ? "" : "cancelled" })}
            />
          </div>
        </div>

        {/* Attending */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">Attendance</span>
          <div className="flex gap-1">
            <Chip
              label="All"
              active={filters.attending === ""}
              onClick={() => applyFilter({ attending: "" })}
            />
            <Chip
              label="Attending only"
              active={filters.attending === "true"}
              onClick={() => applyFilter({ attending: filters.attending === "true" ? "" : "true" })}
            />
          </div>
        </div>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => applyFilter({ local_mehman: "", status: "", attending: "" })}
            className="ml-auto text-xs text-red-500 hover:text-red-700"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
            />
          ))}
        </div>
      )}

      {data && summary && (
        <>
          {/* ── Top stat strip ── */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Total Families"
              value={summary.total_families}
              sub={filters.local_mehman || filters.status ? `${summary.filtered_families} in filter` : "in roster"}
            />
            <StatCard
              label="Registered"
              value={summary.submitted_families}
              sub={`${regRate}% complete`}
              highlight
            />
            <StatCard
              label="Pending"
              value={summary.pending_families}
              sub="not yet submitted"
            />
            <StatCard label="Total Mumineen" value={summary.total_mumineen} />
            <StatCard
              label="Attending"
              value={summary.attending}
              sub={`${summary.not_attending} not attending`}
            />
            <StatCard
              label="Mehman"
              value={summary.mehman}
              sub={`${summary.local} local`}
            />
          </div>

          {/* ── Row 1: Registration status | Attendance | Local vs Mehman ── */}
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <SectionCard title="Registration Status">
              <div className="mb-4">
                <div className="mb-1 flex justify-between text-xs text-gray-500">
                  <span>{summary.submitted_families} registered</span>
                  <span>{regRate}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    className="h-3 rounded-full bg-green-500 transition-all duration-700"
                    style={{ width: `${regRate}%` }}
                  />
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
              <HBar label="Attending" value={summary.attending} total={summary.total_mumineen} color="bg-green-500" />
              <HBar label="Not Attending" value={summary.not_attending} total={summary.total_mumineen} color="bg-red-400" />
              <div className="my-3 border-t border-gray-100 dark:border-gray-700" />
              <HBar label="Adults" value={summary.adults} total={summary.total_mumineen} color="bg-blue-500" />
              <HBar label="Minors" value={summary.minors} total={summary.total_mumineen} color="bg-purple-400" />
            </SectionCard>

            <SectionCard title="Local vs Mehman">
              <HBar label="Mehman" value={summary.mehman} total={summary.total_mumineen} color="bg-indigo-500" />
              <HBar label="Local" value={summary.local} total={summary.total_mumineen} color="bg-teal-500" />
              <div className="my-3 border-t border-gray-100 dark:border-gray-700" />
              {data.gender.map((g) => (
                <HBar key={g.label} label={g.label} value={g.count} total={summary.attending} color="bg-pink-400" />
              ))}
            </SectionCard>
          </div>

          {/* ── Registration timeline ── */}
          {data.timeline.length > 0 && (
            <SectionCard title="Registrations Over Time" className="mb-4">
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-gray-400">Daily submissions</p>
                  <VBars data={data.timeline} color="bg-blue-500" height={80} />
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-400">
                    Cumulative ({summary.submitted_families} total)
                  </p>
                  <VBars
                    data={data.timeline.map((t) => ({ date: t.date, count: t.cumulative }))}
                    color="bg-green-500"
                    height={80}
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {/* ── Row 2: Accommodation | Transport ── */}
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Accommodation"
              filterSlot={
                <input
                  type="search"
                  placeholder="Search hotels…"
                  value={hotelSearch}
                  onChange={(e) => setHotelSearch(e.target.value)}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 w-36"
                />
              }
            >
              {(() => {
                const total = data.accommodation.hotel + data.accommodation.utaro + data.accommodation.not_set;
                return (
                  <>
                    <HBar label="Hotel" value={data.accommodation.hotel} total={total} color="bg-blue-500" />
                    <HBar label="Utaro / Host" value={data.accommodation.utaro} total={total} color="bg-emerald-500" />
                    {data.accommodation.not_set > 0 && (
                      <HBar label="Not set" value={data.accommodation.not_set} total={total} color="bg-gray-300" />
                    )}
                    {data.accommodation.open_to_utaro > 0 && (
                      <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                        {data.accommodation.open_to_utaro} hotel{" "}
                        {data.accommodation.open_to_utaro === 1 ? "family" : "families"} open to utaro
                      </p>
                    )}
                    {filteredHotels.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                          {hotelSearch ? `Hotels matching "${hotelSearch}"` : "Top hotels"}
                        </p>
                        {filteredHotels.map((h) => (
                          <HBar key={h.name} label={h.name} value={h.count} total={data.accommodation.hotel} color="bg-blue-400" />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </SectionCard>

            <SectionCard title="Daily Transport to Relay Center">
              <HBar label="Rideshare" value={data.transport.rideshare} total={transportTotal} color="bg-violet-500" />
              <HBar label="Rental Car" value={data.transport.rental} total={transportTotal} color="bg-orange-400" />
              <HBar label="With Friends/Family" value={data.transport.commute_with_utaro} total={transportTotal} color="bg-teal-500" />
              <HBar label="Other" value={data.transport.other} total={transportTotal} color="bg-gray-400" />
              {data.transport.not_set > 0 && (
                <HBar label="Not set" value={data.transport.not_set} total={transportTotal} color="bg-gray-200" />
              )}
            </SectionCard>
          </div>

          {/* ── Row 3: Arrivals | Departures ── */}
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
                  {airportFilter ? (
                    <p className="mb-2 rounded bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                      Arrival date breakdown by airport requires individual-level data — showing totals.
                      {airportFilter === "ORD" && ` ORD total: ${data.airports.ORD}`}
                      {airportFilter === "MDW" && ` MDW total: ${data.airports.MDW}`}
                    </p>
                  ) : (
                    <VBars data={arrivals} color="bg-blue-500" height={80} />
                  )}
                  <div className="mt-3 flex gap-4 text-xs text-gray-500">
                    <span><strong className="text-gray-700 dark:text-gray-300">ORD</strong> {data.airports.ORD}</span>
                    <span><strong className="text-gray-700 dark:text-gray-300">MDW</strong> {data.airports.MDW}</span>
                    {data.airports.not_set > 0 && (
                      <span className="text-amber-600">{data.airports.not_set} airport not set</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <HBar label="ORD — O'Hare" value={data.airports.ORD} total={airportTotal} color="bg-blue-500" />
                    <HBar label="MDW — Midway" value={data.airports.MDW} total={airportTotal} color="bg-sky-400" />
                    {data.airports.not_set > 0 && (
                      <HBar label="Not set" value={data.airports.not_set} total={airportTotal} color="bg-gray-300" />
                    )}
                  </div>
                </>
              )}
            </SectionCard>

            <SectionCard title="Departure Dates (Mehman)">
              {data.departures_by_date.length === 0 ? (
                <p className="text-sm text-gray-400">No departure data yet</p>
              ) : (
                <VBars data={data.departures_by_date} color="bg-rose-400" height={80} />
              )}
            </SectionCard>
          </div>

          {/* ── Row 4: Age groups | Khidmat ── */}
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Age Groups (Attending)">
              <HBar label="Under 12" value={data.age_groups.under_12} total={summary.attending} color="bg-yellow-400" />
              <HBar label="Teen (12–17)" value={data.age_groups.teen_12_17} total={summary.attending} color="bg-orange-400" />
              <HBar label="Adult (18–59)" value={data.age_groups.adult_18_59} total={summary.attending} color="bg-blue-500" />
              <HBar label="Senior (60+)" value={data.age_groups.senior_60_plus} total={summary.attending} color="bg-purple-500" />
              {data.age_groups.unknown > 0 && (
                <HBar label="Age unknown" value={data.age_groups.unknown} total={summary.attending} color="bg-gray-300" />
              )}
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
                    <HBar label="Interested" value={data.khidmat.wants} total={total} color="bg-green-500" />
                    <HBar label="Not interested" value={data.khidmat.not_wants} total={total} color="bg-red-400" />
                    {data.khidmat.not_set > 0 && (
                      <HBar label="Not answered" value={data.khidmat.not_set} total={total} color="bg-gray-300" />
                    )}
                    {khidmatDepts.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                          {khidmatDeptFilter ? "Selected department" : "By department"}
                        </p>
                        {khidmatDepts.map((d) => (
                          <HBar key={d.id} label={d.name} value={d.count} total={data.khidmat.wants} color="bg-green-400" />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </SectionCard>
          </div>

          {/* ── Row 5: Accessibility | Missing data ── */}
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Accessibility Needs">
              <div className="space-y-3">
                {[
                  { label: "Rahat Seating", value: data.accessibility.rahat_seating, color: "bg-amber-400", desc: "Reserved or assisted seating in majlis" },
                  { label: "Wheelchair", value: data.accessibility.wheelchair, color: "bg-orange-500", desc: "Needs wheelchair access or assistance" },
                  { label: "Special Needs", value: data.accessibility.special_needs, color: "bg-red-400", desc: "Dietary, medical, or mobility notes on file" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div className={`mt-1 h-3 w-3 shrink-0 rounded-full ${item.color}`} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                        {item.value.toLocaleString()} mumineen
                      </p>
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className="text-xs text-gray-400">{item.desc}</p>
                    </div>
                  </div>
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
                  <p className="mb-3 text-xs text-gray-400">
                    Counts are for attending members whose families have already submitted.
                  </p>
                  {[
                    { label: "No WhatsApp number", value: data.missing_data.no_whatsapp, urgent: true },
                    { label: "No email", value: data.missing_data.no_email, urgent: false },
                    { label: "No arrival date (Mehman)", value: data.missing_data.no_arrival, urgent: false },
                    { label: "No airport selected (Mehman)", value: data.missing_data.no_airport, urgent: false },
                    { label: "No flight number (Mehman)", value: data.missing_data.no_flight_no, urgent: false },
                  ]
                    .filter((item) => item.value > 0)
                    .map((item) => (
                      <div
                        key={item.label}
                        className={`flex items-center justify-between rounded-lg px-4 py-2.5 text-sm ${
                          item.urgent
                            ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                            : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="font-semibold">{item.value.toLocaleString()}</span>
                      </div>
                    ))}
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </main>
  );
}
