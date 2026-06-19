"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import InfoIcon from "@/components/admin/niyaz/InfoIcon";
import VBars from "@/components/admin/charts/VBars";
import { buildDailyTimeline } from "@/lib/charts/timeline";
import { isKid, isMehman, type NiyazBreakdown } from "@/lib/rsvp/niyaz-breakdown";

type RespRow = {
  id: string;
  attending: boolean;
  source: string;
  responded_by_phone: string | null;
  recorded_by: string | null;
  updated_at: string;
  mumin: { full_name: string | null; its: string | null; is_adult: boolean | null; local_mehman: string | null } | null;
  family: { hof_its: string | null } | null;
};

type UnregRow = {
  id: string;
  phone_e164: string;
  attending: boolean;
  adults: number;
  kids: number;
  its_number: string | null;
  source: string;
  created_at: string;
};

type Tally = {
  mode: "min" | "max";
  yes: number;
  no: number;
  yesAdults: number;
  yesKids: number;
  noAdults: number;
  noKids: number;
};

type Instance = {
  id: string;
  title: string | null;
  event_date: string | null;
  hijri_date: string | null;
  meal: string | null;
  serving_type: string | null;
};

// One row per roster-active family for the "By Family" view (from GET …/instances/[id]/families).
type FamilyRow = {
  family_id: string;
  hof_its: string;
  hof_name: string;
  responded: boolean;
  attending: number;
  guests: number;
  responded_at: string | null;
  responded_by: string | null;
};

// One row per eligible-to-RSVP member for the "By Individual" view (from GET …/instances/[id]/individuals).
// Left-joined to niyaz_rsvp, so members who never replied appear with attending/source null + responded
// false ("No response"). `whatsapp` is the member's contact number for the CSV export.
type IndividualRow = {
  mumin_id: string;
  its: string | null;
  full_name: string | null;
  is_adult: boolean | null;
  local_mehman: string | null;
  hof_its: string | null;
  whatsapp: string | null;
  attending: boolean | null;
  source: string | null;
  responded_by: string | null;
  updated_at: string | null;
  responded: boolean;
};

// How each niyaz_rsvp row got its value — lets staff tell a real confirmation from a seeded default.
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  default: { label: "Seeded (arrival)", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  registration: { label: "Registration", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  whatsapp: { label: "WhatsApp", cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
  admin: { label: "Admin", cls: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
};

function sourceMeta(source: string) {
  return SOURCE_META[source] ?? { label: source || "—", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" };
}

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

function dayLabel(date: string | null): string {
  if (!date) return "—";
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

// Both response grids hold the full event client-side (thousands of rows). Rendering all of them at
// once freezes the page on each keystroke, so cap the rendered rows and reveal more on demand.
const ROWS_PER_PAGE = 100;

// A family's RSVP answer for the By Family grid. "responded" only means a whatsapp/admin reply exists,
// so split it into the actual answer: attending (Yes), responded-but-zero (No), or never replied.
type FamilyStatus = "yes" | "no" | "noresponse";
function familyStatus(f: { responded: boolean; attending: number; guests: number }): FamilyStatus {
  if (!f.responded) return "noresponse";
  return f.attending + f.guests > 0 ? "yes" : "no";
}

// A member's RSVP answer for the By Individual grid. "responded" only means a whatsapp/admin reply
// exists; without one the member never replied (no row, or just a seeded/registration default).
function individualStatus(r: { responded: boolean; attending: boolean | null }): FamilyStatus {
  if (!r.responded) return "noresponse";
  return r.attending ? "yes" : "no";
}

// CSV cell escaping (quote when the value holds a comma, quote, or newline) — mirrors the registration
// export. Used by the By Individual "Export CSV" action.
function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Row-count footer for a windowed table: shows how many of the filtered rows are rendered and reveals
// more on demand (keeps the DOM small so search stays responsive on multi-thousand-row events).
function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  const visible = Math.min(shown, total);
  return (
    <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-gray-100 bg-white px-2 py-1.5 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <span>
        Showing {visible} of {total}
      </span>
      {shown < total && (
        <button
          type="button"
          onClick={onMore}
          className="rounded-md border border-gray-300 px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Show more ({total - visible} more)
        </button>
      )}
    </div>
  );
}

// Small segmented control used for the responses-table filters.
function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>}
      <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2 py-1 text-xs font-medium ${i > 0 ? "border-l border-gray-300 dark:border-gray-700" : ""} ${
              value === opt.value
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            } ${i === 0 ? "rounded-l-md" : ""} ${i === options.length - 1 ? "rounded-r-md" : ""}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NiyazEventPageInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "max" ? "max" : "min";

  const [instance, setInstance] = useState<Instance | null>(null);
  const [responses, setResponses] = useState<RespRow[]>([]);
  const [unregResponses, setUnregResponses] = useState<UnregRow[]>([]);
  const [tally, setTally] = useState<Tally | null>(null);
  const [breakdown, setBreakdown] = useState<NiyazBreakdown | null>(null);
  // Responses section view: family-level grid vs the per-mumin list.
  const [respView, setRespView] = useState<"family" | "individual">("family");
  const [families, setFamilies] = useState<FamilyRow[] | null>(null);
  const [familySearch, setFamilySearch] = useState("");
  const [familyRespFilter, setFamilyRespFilter] = useState<"all" | "yes" | "no" | "noresponse">("all");
  // The By Individual grid (one row per eligible member, paged server-side) — loaded lazily on first view.
  const [individuals, setIndividuals] = useState<IndividualRow[] | null>(null);
  const [respSearch, setRespSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "local" | "mehman">("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "adults" | "kids">("all");
  const [rsvpFilter, setRsvpFilter] = useState<"all" | "yes" | "no" | "noresponse">("all");
  // How many rows each grid currently renders (capped for performance; "Show more" raises it).
  const [indivShown, setIndivShown] = useState(ROWS_PER_PAGE);
  const [familyShown, setFamilyShown] = useState(ROWS_PER_PAGE);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (instanceId: string, m: string) => {
    const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/responses?mode=${m}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to load event.");
      return;
    }
    setInstance((data.instance as Instance) ?? null);
    setResponses((data.responses as RespRow[]) ?? []);
    setUnregResponses((data.unregistered as UnregRow[]) ?? []);
    setTally((data.tally as Tally) ?? null);
    setBreakdown((data.breakdown as NiyazBreakdown) ?? null);
  }, []);

  // The By Family grid (~1k rows, paged server-side) is loaded lazily the first time that tab is shown.
  const loadFamilies = useCallback(async (instanceId: string) => {
    const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/families`);
    const data = await res.json().catch(() => ({}));
    setFamilies(res.ok ? ((data.families as FamilyRow[]) ?? []) : []);
  }, []);

  // The By Individual grid (one row per eligible member, paged server-side) is also loaded lazily.
  const loadIndividuals = useCallback(async (instanceId: string) => {
    const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/individuals`);
    const data = await res.json().catch(() => ({}));
    setIndividuals(res.ok ? ((data.individuals as IndividualRow[]) ?? []) : []);
  }, []);

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    if (!canAccessPortal(user)) {
      router.push("/admin/conversations");
      return;
    }
    if (id) void load(id, mode);
  }, [router, id, mode, load]);

  useEffect(() => {
    if (id && respView === "family" && families === null) void loadFamilies(id);
  }, [id, respView, families, loadFamilies]);

  useEffect(() => {
    if (id && respView === "individual" && individuals === null) void loadIndividuals(id);
  }, [id, respView, individuals, loadIndividuals]);

  // A changed search/filter should show results from the top again, not deep in a previous window.
  useEffect(() => {
    setIndivShown(ROWS_PER_PAGE);
  }, [respSearch, typeFilter, ageFilter, rsvpFilter]);
  useEffect(() => {
    setFamilyShown(ROWS_PER_PAGE);
  }, [familySearch, familyRespFilter]);

  const q = respSearch.trim().toLowerCase();
  const chipFiltersActive = typeFilter !== "all" || ageFilter !== "all" || rsvpFilter !== "all";
  const filteredIndividuals = (individuals ?? []).filter((r) => {
    if (q) {
      const matchesSearch =
        (r.full_name ?? "").toLowerCase().includes(q) ||
        (r.its ?? "").toLowerCase().includes(q) ||
        (r.hof_its ?? "").toLowerCase().includes(q) ||
        (r.responded_by ?? "").toLowerCase().includes(q) ||
        (r.whatsapp ?? "").toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }
    if (typeFilter !== "all" && (typeFilter === "mehman") !== isMehman(r.local_mehman)) return false;
    if (ageFilter !== "all" && (ageFilter === "kids") !== isKid(r.is_adult)) return false;
    if (rsvpFilter !== "all" && individualStatus(r) !== rsvpFilter) return false;
    return true;
  });
  // The chip filters describe per-mumin attributes that unregistered guests don't carry, so any active
  // chip hides the unregistered table; the search box still applies to it.
  const filteredUnreg = chipFiltersActive
    ? []
    : q
      ? unregResponses.filter((u) => u.phone_e164.toLowerCase().includes(q) || (u.its_number ?? "").toLowerCase().includes(q))
      : unregResponses;

  // By Family grid filtering (HOF name / ITS search + responded chip).
  const fq = familySearch.trim().toLowerCase();
  const familyFilterActive = fq.length > 0 || familyRespFilter !== "all";
  const filteredFamilies = (families ?? []).filter((f) => {
    if (familyRespFilter !== "all" && familyStatus(f) !== familyRespFilter) return false;
    if (fq) return f.hof_name.toLowerCase().includes(fq) || f.hof_its.toLowerCase().includes(fq);
    return true;
  });

  // Yes/No headline from the mode-aware DB aggregate (matches the days overview exactly).
  const yesCount = tally?.yes ?? 0;
  const noCount = tally?.no ?? 0;
  const thaals = Math.ceil(yesCount / 8); // one thaal per 8 attending heads

  // "Responses over time": when RSVPs actually arrived. Registered rows count on their updated_at, but
  // only genuine responses (source !== "default" excludes seeded arrival rows, which would otherwise
  // spike on event-setup day). Unregistered rows are always real responses → count on created_at.
  const responseTimeline = buildDailyTimeline([
    ...responses.filter((r) => r.source !== "default").map((r) => r.updated_at),
    ...unregResponses.map((u) => u.created_at),
  ]);
  const totalResponses = responseTimeline.reduce((sum, t) => sum + t.count, 0);

  const title = instance?.title || dayLabel(instance?.event_date ?? null);
  const subtitle = [dayLabel(instance?.event_date ?? null), instance?.meal, instance?.serving_type].filter(Boolean).join(" · ");

  // Export the *currently filtered* By Individual rows (e.g. filter to "No response" first) so staff
  // get the exact contact list to follow up with. Client-side Blob download with a UTF-8 BOM so Excel
  // reads it without mojibake — mirrors the registration export.
  const exportIndividualsCsv = () => {
    const header = ["Name", "ITS", "Local/Mehman", "WhatsApp number"];
    const lines = filteredIndividuals.map((r) =>
      [
        r.full_name ?? "",
        r.its ?? "",
        isMehman(r.local_mehman) ? "Mehman" : "Local",
        r.whatsapp ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `niyaz-${instance?.event_date ?? "event"}-individuals.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/admin/niyaz")}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          ← Niyaz
        </button>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {!error && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-4 sm:max-w-xl">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-400">Yes count</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-green-600 dark:text-green-400">{yesCount}</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {tally?.yesAdults ?? 0} adults · {tally?.yesKids ?? 0} kids
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-400">No count</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-red-500">{noCount}</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {tally?.noAdults ?? 0} adults · {tally?.noKids ?? 0} kids
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-gray-400">
                Thaals
                <InfoIcon label="Thaals = Yes count ÷ 8 (rounded up)" />
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-gray-700 dark:text-gray-200">{thaals}</div>
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 flex items-center gap-1 text-lg font-semibold">
              Breakdown
              <InfoIcon label="Confirmation-based counts (RSVP set via WhatsApp or admin) for the members eligible to RSVP. Computed from a DB aggregate, so it covers the whole event (not the 1000-row response list). This intentionally differs from the headline cards, which count every row regardless of confirmation." />
            </h2>
            {!breakdown ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-1.5">Group</th>
                    <th className="px-2 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1">
                        Eligible
                        <InfoIcon label="Members eligible to RSVP = all Locals (roster-active & attending) + Mehmaan whose family registration is submitted (roster-active & attending). Total = Local + Mehmaan eligible members; guests are not included. Eligible = Responded + Not responded." />
                      </span>
                    </th>
                    <th className="px-2 py-1.5 text-right">Yes</th>
                    <th className="px-2 py-1.5 text-right">No</th>
                    <th className="px-2 py-1.5 text-right">Responded</th>
                    <th className="px-2 py-1.5 text-right">Not responded</th>
                    <th className="px-2 py-1.5 text-right">Response rate</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "local", label: "Local", g: breakdown.local },
                    { key: "mehman", label: "Mehmaan", g: breakdown.mehman },
                    { key: "total", label: "Total", g: breakdown.total },
                    // Guests only appear when the event has overflow placeholders.
                    ...(breakdown.guest.yes > 0 ? [{ key: "guest", label: "Guests", g: breakdown.guest }] : []),
                  ].map(({ key, label, g }) => {
                    const isGuest = key === "guest";
                    return (
                      <tr
                        key={key}
                        className={`border-t border-gray-100 dark:border-gray-800 ${key === "total" ? "font-semibold" : isGuest ? "text-gray-500 dark:text-gray-400" : ""}`}
                      >
                        <td className="px-2 py-1.5">
                          {isGuest ? (
                            <span className="inline-flex items-center gap-1">
                              {label}
                              <InfoIcon label="Overflow guest placeholders (not roster members) who RSVP'd yes; counted in the headline & Thaals but kept out of the member totals." />
                            </span>
                          ) : (
                            label
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{isGuest ? "—" : g.eligible}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-green-600 dark:text-green-400">
                          {g.yes}
                          <span className="ml-1 text-xs font-normal text-gray-400">({g.yesAdults}a · {g.yesKids}k)</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-red-500">
                          {isGuest ? "—" : (
                            <>
                              {g.no}
                              <span className="ml-1 text-xs font-normal text-gray-400">({g.noAdults}a · {g.noKids}k)</span>
                            </>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{isGuest ? "—" : g.responded}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{isGuest ? "—" : g.notResponded}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{isGuest ? "—" : pct(g.responseRate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>

          {responseTimeline.length > 0 && (
            <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 flex items-center gap-1 text-lg font-semibold">
                Responses over time
                <InfoIcon label="When RSVPs were received, by day. Counts genuine responses (registration, WhatsApp, admin) on the date they were last set, plus unregistered RSVPs; seeded arrival defaults are excluded." />
              </h2>
              <p className="mb-1 text-xs text-gray-400">Daily responses</p>
              <VBars data={responseTimeline.map((t) => ({ date: t.date, count: t.count }))} color="bg-blue-500" height={64} />
              <p className="mb-1 mt-4 text-xs text-gray-400">Cumulative ({totalResponses} total)</p>
              <VBars data={responseTimeline.map((t) => ({ date: t.date, count: t.cumulative }))} color="bg-green-500" height={64} />
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">RSVP responses</h2>
              <FilterChips
                label=""
                value={respView}
                onChange={setRespView}
                options={[
                  { value: "family", label: "By Family" },
                  { value: "individual", label: "By Individual" },
                ]}
              />
            </div>

            {respView === "family" && (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <input
                    type="search"
                    value={familySearch}
                    onChange={(e) => setFamilySearch(e.target.value)}
                    placeholder="Search by HOF name or ITS…"
                    className={`${inputCls} max-w-xs`}
                  />
                  <FilterChips
                    label="RSVP"
                    value={familyRespFilter}
                    onChange={setFamilyRespFilter}
                    options={[
                      { value: "all", label: "All" },
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "noresponse", label: "No response" },
                    ]}
                  />
                  {familyFilterActive && families && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {filteredFamilies.length} of {families.length}
                    </span>
                  )}
                </div>
                {families === null ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
                ) : filteredFamilies.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {familyFilterActive ? "No families match the current filters." : "No families."}
                  </p>
                ) : (
                  <div className="max-h-[32rem] overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-white text-xs uppercase text-gray-400 dark:bg-gray-900">
                        <tr>
                          <th className="px-2 py-1.5">Head of family</th>
                          <th className="px-2 py-1.5" title="Yes = attending · No = replied not attending · No response = no reply yet">RSVP</th>
                          <th className="px-2 py-1.5 text-right">Attending</th>
                          <th className="px-2 py-1.5 text-right">Guests</th>
                          <th className="px-2 py-1.5" title="Phone (WhatsApp) or admin who responded">By</th>
                          <th className="px-2 py-1.5">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFamilies.slice(0, familyShown).map((f) => {
                          const status = familyStatus(f);
                          const rsvp =
                            status === "yes"
                              ? { label: "Yes", cls: "text-green-600 dark:text-green-400" }
                              : status === "no"
                                ? { label: "No", cls: "text-red-500" }
                                : { label: "No response", cls: "text-gray-400" };
                          return (
                            <tr key={f.family_id} className="border-t border-gray-100 dark:border-gray-800">
                              <td className="px-2 py-1.5">
                                {f.hof_name}
                                {f.hof_name !== f.hof_its && (
                                  <span className="ml-1 font-mono text-xs text-gray-400">{f.hof_its}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <span className={rsvp.cls}>{rsvp.label}</span>
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{f.responded ? f.attending : "—"}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{f.guests > 0 ? f.guests : f.responded ? 0 : "—"}</td>
                              <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{f.responded_by ?? "—"}</td>
                              <td className="px-2 py-1.5 text-xs text-gray-500">
                                {f.responded_at ? new Date(f.responded_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <ShowMore shown={familyShown} total={filteredFamilies.length} onMore={() => setFamilyShown((n) => n + ROWS_PER_PAGE)} />
                  </div>
                )}
              </>
            )}

            {respView === "individual" && (
            <>
              <div className="mb-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={respSearch}
                    onChange={(e) => setRespSearch(e.target.value)}
                    placeholder="Search by name, ITS, or phone…"
                    className={`${inputCls} max-w-xs`}
                  />
                  <button
                    type="button"
                    onClick={exportIndividualsCsv}
                    disabled={filteredIndividuals.length === 0}
                    title="Export the filtered rows (Name, ITS, Local/Mehman, WhatsApp number) as CSV"
                    className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    Export CSV
                  </button>
                  {(q || chipFiltersActive) && individuals && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {filteredIndividuals.length + filteredUnreg.length} of {individuals.length + unregResponses.length}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <FilterChips
                    label="Type"
                    value={typeFilter}
                    onChange={setTypeFilter}
                    options={[
                      { value: "all", label: "All" },
                      { value: "local", label: "Local" },
                      { value: "mehman", label: "Mehmaan" },
                    ]}
                  />
                  <FilterChips
                    label="Age"
                    value={ageFilter}
                    onChange={setAgeFilter}
                    options={[
                      { value: "all", label: "All" },
                      { value: "adults", label: "Adults" },
                      { value: "kids", label: "Kids" },
                    ]}
                  />
                  <FilterChips
                    label="RSVP"
                    value={rsvpFilter}
                    onChange={setRsvpFilter}
                    options={[
                      { value: "all", label: "All" },
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "noresponse", label: "No response" },
                    ]}
                  />
                </div>
              </div>

            {individuals === null ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : (
              <>
                {filteredIndividuals.length === 0 && filteredUnreg.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {q || chipFiltersActive ? "No members match the current filters." : "No members."}
                  </p>
                ) : null}

                {filteredIndividuals.length > 0 && (
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-white text-xs uppercase text-gray-400 dark:bg-gray-900">
                        <tr>
                          <th className="px-2 py-1.5">Name</th>
                          <th className="px-2 py-1.5" title="Yes = attending · No = replied not attending · No response = no reply yet">RSVP</th>
                          <th className="px-2 py-1.5" title="How this RSVP was set">Source</th>
                          <th className="px-2 py-1.5" title="Phone (WhatsApp) or admin who set it">Responded by</th>
                          <th className="px-2 py-1.5">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredIndividuals.slice(0, indivShown).map((r) => {
                          const status = individualStatus(r);
                          const rsvp =
                            status === "yes"
                              ? { label: "Yes", cls: "text-green-600 dark:text-green-400" }
                              : status === "no"
                                ? { label: "No", cls: "text-red-500" }
                                : { label: "No response", cls: "text-gray-400" };
                          const meta = r.source ? sourceMeta(r.source) : null;
                          return (
                            <tr key={r.mumin_id} className="border-t border-gray-100 dark:border-gray-800">
                              <td className="px-2 py-1.5">
                                {r.full_name ?? r.its ?? "—"}
                                {r.is_adult === false ? <span className="ml-1 text-xs text-gray-400">(kid)</span> : null}
                              </td>
                              <td className="px-2 py-1.5">
                                <span className={rsvp.cls}>{rsvp.label}</span>
                              </td>
                              <td className="px-2 py-1.5">
                                {meta ? (
                                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{r.responded_by ?? "—"}</td>
                              <td className="px-2 py-1.5 text-xs text-gray-500">
                                {r.updated_at ? new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <ShowMore shown={indivShown} total={filteredIndividuals.length} onMore={() => setIndivShown((n) => n + ROWS_PER_PAGE)} />
                  </div>
                )}

                {filteredUnreg.length > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Unregistered guests ({filteredUnreg.length})</h3>
                    <div className="max-h-60 overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-white text-xs uppercase text-gray-400 dark:bg-gray-900">
                          <tr>
                            <th className="px-2 py-1.5">Phone</th>
                            <th className="px-2 py-1.5">RSVP</th>
                            <th className="px-2 py-1.5">Adults</th>
                            <th className="px-2 py-1.5">Kids</th>
                            <th className="px-2 py-1.5">ITS</th>
                            <th className="px-2 py-1.5">When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredUnreg.map((u) => (
                            <tr key={u.id} className="border-t border-gray-100 dark:border-gray-800">
                              <td className="px-2 py-1.5 font-mono text-xs">{u.phone_e164}</td>
                              <td className="px-2 py-1.5">
                                <span className={u.attending ? "text-green-600 dark:text-green-400" : "text-red-500"}>{u.attending ? "Yes" : "No"}</span>
                              </td>
                              <td className="px-2 py-1.5 tabular-nums">{u.adults}</td>
                              <td className="px-2 py-1.5 tabular-nums">{u.kids}</td>
                              <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{u.its_number ?? "—"}</td>
                              <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(u.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
            </>
            )}
          </div>
        </>
      )}
    </main>
  );
}

export default function NiyazEventPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8" />}>
      <NiyazEventPageInner />
    </Suspense>
  );
}
