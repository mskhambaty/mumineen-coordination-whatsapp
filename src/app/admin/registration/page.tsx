"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { canAccessMumineen } from "@/lib/admin/access";

// ─── Types ────────────────────────────────────────────────────────────────────

type Analytics = {
  generated_at: string;
  summary: {
    total_families: number;
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
  showCount = true,
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
  showCount?: boolean;
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
      {showCount && (
        <span className="w-24 shrink-0 text-right text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {value.toLocaleString()}
          </span>
          <span className="ml-1 text-xs text-gray-400">({Math.round(pct)}%)</span>
        </span>
      )}
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
    return (
      <p className="py-6 text-center text-sm text-gray-400">No data yet</p>
    );
  const max = Math.max(...data.map((d) => d.count), 1);
  const fmtDate = (d: string) => {
    const [, m, day] = d.split("-");
    return `${parseInt(m)}/${parseInt(day)}`;
  };
  return (
    <div className="mt-2 overflow-x-auto">
      <div
        className="flex min-w-0 items-end gap-0.5"
        style={{ height: `${height + 20}px` }}
      >
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
            {/* tooltip */}
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
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800/50 ${className}`}
    >
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function RegistrationAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adminKey =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_ADMIN_KEY ?? "")
      : "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/registration-analytics", {
        headers: { "x-admin-key": adminKey },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json as Analytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const raw = localStorage.getItem("admin_user");
    const user = raw ? JSON.parse(raw) : null;
    if (!canAccessMumineen(user)) {
      router.push("/admin/conversations");
      return;
    }
    void load();
  }, [router, load]);

  if (loading)
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <p className="text-sm text-gray-400">Loading analytics…</p>
      </main>
    );
  if (error)
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <p className="text-sm text-red-500">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </main>
    );
  if (!data) return null;

  const { summary, timeline, accommodation, transport, airports, arrivals_by_date, departures_by_date, gender, age_groups, khidmat, accessibility, missing_data } = data;

  const regRate =
    summary.total_families > 0
      ? Math.round((summary.submitted_families / summary.total_families) * 100)
      : 0;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const transportTotal =
    transport.rideshare +
    transport.rental +
    transport.commute_with_utaro +
    transport.other +
    transport.not_set;

  const airportTotal = airports.ORD + airports.MDW + airports.not_set;

  const missingTotal =
    missing_data.no_whatsapp +
    missing_data.no_email +
    missing_data.no_arrival +
    missing_data.no_airport +
    missing_data.no_flight_no;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Registration Analytics
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Live snapshot of all mumineen registration data.
            {data.generated_at && (
              <span className="ml-2 text-gray-400">
                Updated {fmtDate(data.generated_at)}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      {/* ── Top stat strip ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Families"
          value={summary.total_families}
          sub="in roster"
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
        <StatCard
          label="Total Mumineen"
          value={summary.total_mumineen}
        />
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

      {/* ── Row 1: Registration progress | Attendance | Demographics ── */}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Registration Status">
          {/* Progress bar */}
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
          <HBar
            label="Submitted"
            value={summary.submitted_families}
            total={summary.total_families}
            color="bg-green-500"
          />
          <HBar
            label="Pending"
            value={summary.pending_families}
            total={summary.total_families}
            color="bg-amber-400"
          />
          {summary.confirmed_families > 0 && (
            <HBar
              label="Confirmed"
              value={summary.confirmed_families}
              total={summary.total_families}
              color="bg-blue-500"
            />
          )}
          {summary.cancelled_families > 0 && (
            <HBar
              label="Cancelled"
              value={summary.cancelled_families}
              total={summary.total_families}
              color="bg-red-400"
            />
          )}
        </SectionCard>

        <SectionCard title="Attendance">
          <HBar
            label="Attending"
            value={summary.attending}
            total={summary.total_mumineen}
            color="bg-green-500"
          />
          <HBar
            label="Not Attending"
            value={summary.not_attending}
            total={summary.total_mumineen}
            color="bg-red-400"
          />
          <div className="my-3 border-t border-gray-100 dark:border-gray-700" />
          <HBar
            label="Adults"
            value={summary.adults}
            total={summary.total_mumineen}
            color="bg-blue-500"
          />
          <HBar
            label="Minors"
            value={summary.minors}
            total={summary.total_mumineen}
            color="bg-purple-400"
          />
        </SectionCard>

        <SectionCard title="Local vs Mehman">
          <HBar
            label="Mehman"
            value={summary.mehman}
            total={summary.total_mumineen}
            color="bg-indigo-500"
          />
          <HBar
            label="Local"
            value={summary.local}
            total={summary.total_mumineen}
            color="bg-teal-500"
          />
          <div className="my-3 border-t border-gray-100 dark:border-gray-700" />
          {gender.map((g) => (
            <HBar
              key={g.label}
              label={g.label}
              value={g.count}
              total={summary.attending}
              color="bg-pink-400"
            />
          ))}
        </SectionCard>
      </div>

      {/* ── Registration timeline ── */}
      {timeline.length > 0 && (
        <SectionCard title="Registrations Over Time" className="mb-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-gray-400">Daily submissions</p>
              <VBars data={timeline} color="bg-blue-500" height={80} />
            </div>
            <div>
              <p className="mb-1 text-xs text-gray-400">
                Cumulative ({summary.submitted_families} total)
              </p>
              <VBars
                data={timeline.map((t) => ({ date: t.date, count: t.cumulative }))}
                color="bg-green-500"
                height={80}
              />
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Row 2: Accommodation | Transport ── */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Accommodation">
          {(() => {
            const total = accommodation.hotel + accommodation.utaro + accommodation.not_set;
            return (
              <>
                <HBar
                  label="Hotel"
                  value={accommodation.hotel}
                  total={total}
                  color="bg-blue-500"
                />
                <HBar
                  label="Utaro / Host"
                  value={accommodation.utaro}
                  total={total}
                  color="bg-emerald-500"
                />
                {accommodation.not_set > 0 && (
                  <HBar
                    label="Not set"
                    value={accommodation.not_set}
                    total={total}
                    color="bg-gray-300"
                  />
                )}
                {accommodation.open_to_utaro > 0 && (
                  <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    {accommodation.open_to_utaro} hotel{" "}
                    {accommodation.open_to_utaro === 1 ? "family" : "families"} open to utaro if
                    available
                  </p>
                )}
                {accommodation.top_hotels.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                      Top hotels
                    </p>
                    {accommodation.top_hotels.map((h) => (
                      <HBar
                        key={h.name}
                        label={h.name}
                        value={h.count}
                        total={accommodation.hotel}
                        color="bg-blue-400"
                      />
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </SectionCard>

        <SectionCard title="Daily Transport to Relay Center">
          <HBar
            label="Rideshare"
            value={transport.rideshare}
            total={transportTotal}
            color="bg-violet-500"
          />
          <HBar
            label="Rental Car"
            value={transport.rental}
            total={transportTotal}
            color="bg-orange-400"
          />
          <HBar
            label="With Friends/Family"
            value={transport.commute_with_utaro}
            total={transportTotal}
            color="bg-teal-500"
          />
          <HBar
            label="Other"
            value={transport.other}
            total={transportTotal}
            color="bg-gray-400"
          />
          {transport.not_set > 0 && (
            <HBar
              label="Not set"
              value={transport.not_set}
              total={transportTotal}
              color="bg-gray-200"
            />
          )}
        </SectionCard>
      </div>

      {/* ── Row 3: Arrivals | Departures ── */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Arrival Dates (Mehman)">
          {arrivals_by_date.length === 0 ? (
            <p className="text-sm text-gray-400">No arrival data yet</p>
          ) : (
            <>
              <VBars data={arrivals_by_date} color="bg-blue-500" height={80} />
              <div className="mt-3 flex gap-4 text-xs text-gray-500">
                <span>
                  <strong className="text-gray-700 dark:text-gray-300">ORD</strong>{" "}
                  {airports.ORD}
                </span>
                <span>
                  <strong className="text-gray-700 dark:text-gray-300">MDW</strong>{" "}
                  {airports.MDW}
                </span>
                {airports.not_set > 0 && (
                  <span className="text-amber-600">
                    {airports.not_set} airport not set
                  </span>
                )}
              </div>
              <div className="mt-2">
                <HBar
                  label="ORD — O'Hare"
                  value={airports.ORD}
                  total={airportTotal}
                  color="bg-blue-500"
                />
                <HBar
                  label="MDW — Midway"
                  value={airports.MDW}
                  total={airportTotal}
                  color="bg-sky-400"
                />
                {airports.not_set > 0 && (
                  <HBar
                    label="Not set"
                    value={airports.not_set}
                    total={airportTotal}
                    color="bg-gray-300"
                  />
                )}
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard title="Departure Dates (Mehman)">
          {departures_by_date.length === 0 ? (
            <p className="text-sm text-gray-400">No departure data yet</p>
          ) : (
            <VBars data={departures_by_date} color="bg-rose-400" height={80} />
          )}
        </SectionCard>
      </div>

      {/* ── Row 4: Age groups | Khidmat ── */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Age Groups (Attending)">
          {(() => {
            const total = summary.attending;
            return (
              <>
                <HBar
                  label="Under 12"
                  value={age_groups.under_12}
                  total={total}
                  color="bg-yellow-400"
                />
                <HBar
                  label="Teen (12–17)"
                  value={age_groups.teen_12_17}
                  total={total}
                  color="bg-orange-400"
                />
                <HBar
                  label="Adult (18–59)"
                  value={age_groups.adult_18_59}
                  total={total}
                  color="bg-blue-500"
                />
                <HBar
                  label="Senior (60+)"
                  value={age_groups.senior_60_plus}
                  total={total}
                  color="bg-purple-500"
                />
                {age_groups.unknown > 0 && (
                  <HBar
                    label="Age unknown"
                    value={age_groups.unknown}
                    total={total}
                    color="bg-gray-300"
                  />
                )}
              </>
            );
          })()}
        </SectionCard>

        <SectionCard title="Khidmat Interest (Mehman Attending)">
          {(() => {
            const total = khidmat.wants + khidmat.not_wants + khidmat.not_set;
            return (
              <>
                <HBar
                  label="Interested"
                  value={khidmat.wants}
                  total={total}
                  color="bg-green-500"
                />
                <HBar
                  label="Not interested"
                  value={khidmat.not_wants}
                  total={total}
                  color="bg-red-400"
                />
                {khidmat.not_set > 0 && (
                  <HBar
                    label="Not answered"
                    value={khidmat.not_set}
                    total={total}
                    color="bg-gray-300"
                  />
                )}
                {khidmat.by_department.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                      By department
                    </p>
                    {khidmat.by_department.map((d) => (
                      <HBar
                        key={d.id}
                        label={d.name}
                        value={d.count}
                        total={khidmat.wants}
                        color="bg-green-400"
                      />
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
              {
                label: "Rahat Seating",
                value: accessibility.rahat_seating,
                color: "bg-amber-400",
                desc: "Reserved or assisted seating in majlis",
              },
              {
                label: "Wheelchair",
                value: accessibility.wheelchair,
                color: "bg-orange-500",
                desc: "Needs wheelchair access or assistance",
              },
              {
                label: "Special Needs",
                value: accessibility.special_needs,
                color: "bg-red-400",
                desc: "Dietary, medical, or mobility notes on file",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div
                  className={`mt-1 h-3 w-3 shrink-0 rounded-full ${item.color}`}
                />
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
                These may need a follow-up.
              </p>
              {[
                { label: "No WhatsApp number", value: missing_data.no_whatsapp, urgent: true },
                { label: "No email", value: missing_data.no_email, urgent: false },
                { label: "No arrival date (Mehman)", value: missing_data.no_arrival, urgent: false },
                { label: "No airport selected (Mehman)", value: missing_data.no_airport, urgent: false },
                { label: "No flight number (Mehman)", value: missing_data.no_flight_no, urgent: false },
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
    </main>
  );
}
