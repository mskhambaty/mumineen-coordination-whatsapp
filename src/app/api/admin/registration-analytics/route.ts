import { NextRequest, NextResponse } from "next/server";

import { canViewRegistrations } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { isPendingStatus, isRegisteredStatus, matchesStatusFilter } from "@/lib/registration/status";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MuminRow = {
  its: string;
  full_name: string | null;
  hof_its: string;
  gender: string | null;
  age: number | null;
  is_adult: boolean | null;
  is_head: boolean;
  local_mehman: string | null;
  arrival_at: string | null;
  departure_at: string | null;
  arrival_flight_no: string | null;
  airport: string | null;
  not_attending: boolean | null;
  rahat_seating: boolean | null;
  wheelchair: boolean | null;
  special_needs: string | null;
  wants_khidmat: boolean | null;
  khidmat_department_ids: string[] | null;
  whatsapp_e164: string | null;
  email: string | null;
};

type FamilyRow = {
  hof_its: string;
  registration_status: string | null;
  acc_type: string | null;
  hotel_name: string | null;
  open_to_utaro: boolean | null;
  transport_mode: string | null;
  submitted_at: string | null;
  utaro_host_name: string | null;
  utaro_host_its: string | null;
};

type DeptRow = { id: string; name: string };

// Supabase PostgREST caps rows at 1000 by default — paginate to get all.
async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let start = 0;
  for (;;) {
    const { data } = await buildQuery(start, start + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    start += PAGE;
  }
  return all;
}

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewRegistrations);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  // Filters passed by the UI. Unset means "all".
  const localMehmanFilter = searchParams.get("local_mehman"); // "Local" | "Mehman" | null
  const statusFilter = searchParams.get("status"); // "submitted" | "pending" | null
  const attendingFilter = searchParams.get("attending"); // "true" | null
  const genderFilter = searchParams.get("gender"); // "M" | "F" | null

  const supabase = getSupabaseAdmin();

  const [allMembers, allFams, deptRows] = await Promise.all([
    fetchAll<MuminRow>((from, to) =>
      supabase
        .from("mumineen")
        .select(
          "its, full_name, hof_its, gender, age, is_adult, is_head, local_mehman, arrival_at, departure_at, arrival_flight_no, airport, not_attending, rahat_seating, wheelchair, special_needs, wants_khidmat, khidmat_department_ids, whatsapp_e164, email",
        )
        .eq("roster_active", true)
        .range(from, to),
    ),
    fetchAll<FamilyRow>((from, to) =>
      supabase
        .from("families")
        .select(
          "hof_its, registration_status, acc_type, hotel_name, open_to_utaro, transport_mode, submitted_at, utaro_host_name, utaro_host_its",
        )
        .eq("roster_active", true)
        .range(from, to),
    ),
    supabase
      .from("departments")
      .select("id, name")
      .order("name")
      .then((r) => (r.data ?? []) as DeptRow[]),
  ]);

  const deptMap = new Map(deptRows.map((d) => [d.id, d.name]));

  // ── Apply filters ────────────────────────────────────────────────────────────

  // Member-level filter
  let members = allMembers;
  if (localMehmanFilter) members = members.filter((m) => m.local_mehman === localMehmanFilter);
  if (attendingFilter === "true") members = members.filter((m) => !m.not_attending);
  // Gender is a member-level filter (like attending): it scopes the mumineen/demographic metrics
  // and member drill-downs, but never the family funnel (families aren't gendered).
  if (genderFilter) members = members.filter((m) => (m.gender ?? "").trim() === genderFilter);

  // Family-level filter: when filtering by local_mehman, restrict to families whose HoF matches.
  // When filtering by status, restrict families accordingly.
  // Use any member's local_mehman to identify the family type — not just is_head,
  // because 430 families have no is_head record in mumineen and would otherwise
  // fall through both Local and Mehman filters.
  const hofItsSet = localMehmanFilter
    ? new Set(allMembers.filter((m) => m.local_mehman === localMehmanFilter).map((m) => m.hof_its))
    : null;

  let fams = allFams;
  if (hofItsSet) fams = fams.filter((f) => hofItsSet.has(f.hof_its));
  if (statusFilter) {
    fams = fams.filter((f) => matchesStatusFilter(f.registration_status, statusFilter));
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  const famStatusMap = new Map(fams.map((f) => [f.hof_its, f.registration_status]));
  const isSubmitted = (hofIts: string) => isRegisteredStatus(famStatusMap.get(hofIts) ?? null);
  // Families still pending submission, within the current (status-filtered) set.
  const pendingHofs = new Set(fams.filter((f) => isPendingStatus(f.registration_status)).map((f) => f.hof_its));

  const totalFamilies = allFams.length; // always unfiltered for context
  const submittedFamilies = fams.filter((f) => isRegisteredStatus(f.registration_status)).length;
  const pendingFamilies = fams.filter((f) => isPendingStatus(f.registration_status)).length;

  const attending = members.filter((m) => !m.not_attending);
  const notAttending = members.filter((m) => m.not_attending).length;
  const localCount = members.filter((m) => m.local_mehman === "Local").length;
  const mehmanCount = members.filter((m) => m.local_mehman === "Mehman").length;
  const submittedMumineen = members.filter((m) => isSubmitted(m.hof_its)).length;
  // Count members of pending families directly — NOT total minus submitted. The subtraction
  // wrongly absorbs members of families the status filter removed (e.g. under the Pending filter
  // famStatusMap has no submitted families, so total-submitted ballooned to the whole roster).
  const pendingMumineen = members.filter((m) => pendingHofs.has(m.hof_its)).length;

  // ── Registration timeline ────────────────────────────────────────────────────

  const timelineMap = new Map<string, number>();
  for (const f of fams) {
    if (f.submitted_at) {
      const day = f.submitted_at.slice(0, 10);
      timelineMap.set(day, (timelineMap.get(day) ?? 0) + 1);
    }
  }
  let cumulative = 0;
  const timeline = Array.from(timelineMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => {
      cumulative += count;
      return { date, count, cumulative };
    });

  // ── Accommodation ────────────────────────────────────────────────────────────

  const registeredFams = fams.filter((f) => isRegisteredStatus(f.registration_status));

  // People per family = ALL attending members of that household, regardless of the
  // local_mehman member filter — keeps people counts consistent with the paired
  // family counts (families are filtered by HoF type, not by member type).
  const attendingByHof = new Map<string, number>();
  for (const m of allMembers) {
    if (m.not_attending) continue;
    attendingByHof.set(m.hof_its, (attendingByHof.get(m.hof_its) ?? 0) + 1);
  }
  const famPeople = (f: FamilyRow) => attendingByHof.get(f.hof_its) ?? 0;

  const hotelFams = registeredFams.filter((f) => f.acc_type === "hotel").length;
  const utaroFams = registeredFams.filter((f) => f.acc_type === "utaro").length;
  const openToUtaro = registeredFams.filter((f) => f.acc_type === "hotel" && f.open_to_utaro).length;
  const accNotSet = registeredFams.filter((f) => !f.acc_type).length;
  const hotelPeople = registeredFams.filter((f) => f.acc_type === "hotel").reduce((s, f) => s + famPeople(f), 0);
  const utaroPeople = registeredFams.filter((f) => f.acc_type === "utaro").reduce((s, f) => s + famPeople(f), 0);
  const openToUtaroPeople = registeredFams.filter((f) => f.acc_type === "hotel" && f.open_to_utaro).reduce((s, f) => s + famPeople(f), 0);

  // Placeholder / dirty values users sometimes enter instead of a real hotel name.
  const HOTEL_JUNK = new Set(["pending", "na", "n/a", "n.a", "tbd", "none", "unknown", "no", "-", "--", "tba"]);

  type HotelAgg = { name: string; count: number; people: number; awaiting: number; awaiting_people: number };
  const hotelCounts = new Map<string, HotelAgg>(); // keyed by lowercased name so case variants merge
  for (const f of registeredFams) {
    if (f.acc_type === "hotel" && f.hotel_name?.trim()) {
      const name = f.hotel_name.trim();
      if (HOTEL_JUNK.has(name.toLowerCase())) continue;
      const agg = hotelCounts.get(name.toLowerCase()) ?? { name, count: 0, people: 0, awaiting: 0, awaiting_people: 0 };
      agg.count += 1;
      agg.people += famPeople(f);
      if (f.open_to_utaro) {
        agg.awaiting += 1;
        agg.awaiting_people += famPeople(f);
      }
      hotelCounts.set(name.toLowerCase(), agg);
    }
  }
  const topHotels = Array.from(hotelCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Hosts derived from guest-entered utaro fields: keyed by host ITS when present,
  // else normalized host name (free text — imperfect until the matching feature lands).
  // host_member_count is the size of the host's own family (unfiltered — intrinsic to the host).
  const hostFamilySize = new Map<string, number>();
  for (const m of allMembers) hostFamilySize.set(m.hof_its, (hostFamilySize.get(m.hof_its) ?? 0) + 1);

  type HostAgg = { key: string; label: string; host_name: string; host_its: string | null; host_member_count: number; families: number; people: number };
  const hostMap = new Map<string, HostAgg>();
  for (const f of registeredFams) {
    if (f.acc_type !== "utaro") continue;
    const its = f.utaro_host_its?.trim() || null;
    const normName = (f.utaro_host_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const key = its ? `its:${its}` : normName ? `name:${normName}` : null;
    if (!key) continue;
    const displayName = its ? (f.utaro_host_name?.trim() || "Unknown host") : f.utaro_host_name!.trim();
    const label = its ? `${displayName} (ITS ${its})` : displayName;
    const agg = hostMap.get(key) ?? {
      key, label,
      host_name: displayName, host_its: its,
      host_member_count: its ? (hostFamilySize.get(its) ?? 0) : 0,
      families: 0, people: 0,
    };
    agg.families += 1;
    agg.people += famPeople(f);
    hostMap.set(key, agg);
  }
  const hosts = Array.from(hostMap.values()).sort(
    (a, b) => b.families - a.families || a.label.localeCompare(b.label),
  );

  // ── Transport ────────────────────────────────────────────────────────────────

  // Per-family attending headcount for individual-level transport breakdowns.
  const famAttending = new Map<string, number>();
  for (const m of members) {
    if (!m.not_attending) famAttending.set(m.hof_its, (famAttending.get(m.hof_its) ?? 0) + 1);
  }
  const transportPeople = (mode: string | null) =>
    registeredFams
      .filter((f) => (mode ? f.transport_mode === mode : !f.transport_mode))
      .reduce((sum, f) => sum + (famAttending.get(f.hof_its) ?? 0), 0);

  const transport = {
    rideshare: registeredFams.filter((f) => f.transport_mode === "rideshare").length,
    rideshare_people: transportPeople("rideshare"),
    rental: registeredFams.filter((f) => f.transport_mode === "rental").length,
    rental_people: transportPeople("rental"),
    commute_with_utaro: registeredFams.filter((f) => f.transport_mode === "commute_with_utaro").length,
    commute_with_utaro_people: transportPeople("commute_with_utaro"),
    other: registeredFams.filter((f) => f.transport_mode === "other").length,
    other_people: transportPeople("other"),
    not_set: registeredFams.filter((f) => !f.transport_mode).length,
    not_set_people: transportPeople(null),
  };

  // ── Airport & travel (attending mehman) ──────────────────────────────────────

  const mehmanAttending = members.filter((m) => m.local_mehman === "Mehman" && !m.not_attending && isSubmitted(m.hof_its));
  const airports = {
    ORD: mehmanAttending.filter((m) => m.airport === "ORD").length,
    MDW: mehmanAttending.filter((m) => m.airport === "MDW").length,
    not_set: mehmanAttending.filter((m) => !m.airport).length,
  };

  const arrivalMap = new Map<string, number>();
  const departureMap = new Map<string, number>();
  for (const m of mehmanAttending) {
    if (m.arrival_at) {
      const day = m.arrival_at.slice(0, 10);
      arrivalMap.set(day, (arrivalMap.get(day) ?? 0) + 1);
    }
    if (m.departure_at) {
      const day = m.departure_at.slice(0, 10);
      departureMap.set(day, (departureMap.get(day) ?? 0) + 1);
    }
  }
  const arrivalsByDate = Array.from(arrivalMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  // Group by date + hour for reception scheduling (replaces airport breakdown)
  const arrivalsByDatetimeMap = new Map<string, { date: string; time: string; count: number }>();
  for (const m of mehmanAttending) {
    if (m.arrival_at) {
      const date = m.arrival_at.slice(0, 10);
      const hasTime = m.arrival_at.length > 10 && (m.arrival_at[10] === "T" || m.arrival_at[10] === " ");
      const time = hasTime ? m.arrival_at.slice(11, 13) + ":00" : "";
      const key = `${date}|${time}`;
      const existing = arrivalsByDatetimeMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        arrivalsByDatetimeMap.set(key, { date, time, count: 1 });
      }
    }
  }
  const arrivalsByDatetime = Array.from(arrivalsByDatetimeMap.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
  );

  const departuresByDate = Array.from(departureMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  // ── Gender ───────────────────────────────────────────────────────────────────

  const genderMap = new Map<string, number>();
  for (const m of attending) {
    const g = m.gender?.trim() ?? "Unknown";
    genderMap.set(g, (genderMap.get(g) ?? 0) + 1);
  }
  const gender = Array.from(genderMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));

  // ── Age groups ───────────────────────────────────────────────────────────────

  // Non-overlapping brackets partitioning all known ages.
  const ageGroups = {
    age_0_5: attending.filter((m) => m.age !== null && m.age <= 5).length,
    age_6_11: attending.filter((m) => m.age !== null && m.age >= 6 && m.age <= 11).length,
    age_12_17: attending.filter((m) => m.age !== null && m.age >= 12 && m.age <= 17).length,
    age_18_39: attending.filter((m) => m.age !== null && m.age >= 18 && m.age <= 39).length,
    age_40_59: attending.filter((m) => m.age !== null && m.age >= 40 && m.age <= 59).length,
    age_60_plus: attending.filter((m) => m.age !== null && m.age >= 60).length,
    unknown: attending.filter((m) => m.age === null).length,
  };

  // ── Khidmat ──────────────────────────────────────────────────────────────────

  // Scope to submitted families only — unregistered mehman default to wants_khidmat=false
  // from roster import, which would otherwise inflate the "not wants" count.
  const khidmatPool = members.filter(
    (m) => !m.not_attending && m.local_mehman === "Mehman" && isSubmitted(m.hof_its),
  );
  const wantsKhidmat = khidmatPool.filter((m) => m.wants_khidmat === true).length;
  const notKhidmat = khidmatPool.filter((m) => m.wants_khidmat === false).length;
  const khidmatNotSet = khidmatPool.filter((m) => m.wants_khidmat === null).length;

  const khidmatDeptCounts = new Map<string, number>();
  for (const m of khidmatPool) {
    if (m.wants_khidmat && m.khidmat_department_ids) {
      for (const deptId of m.khidmat_department_ids) {
        khidmatDeptCounts.set(deptId, (khidmatDeptCounts.get(deptId) ?? 0) + 1);
      }
    }
  }
  const khidmatByDept = Array.from(khidmatDeptCounts.entries())
    .map(([id, count]) => ({ id, name: deptMap.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count);

  // ── Accessibility ────────────────────────────────────────────────────────────

  const accessibility = {
    rahat_seating: attending.filter((m) => m.rahat_seating).length,
    wheelchair: attending.filter((m) => m.wheelchair).length,
    special_needs: attending.filter((m) => m.special_needs?.trim()).length,
  };

  // ── Missing data ─────────────────────────────────────────────────────────────

  const submittedAttending = attending.filter((m) => isSubmitted(m.hof_its));
  const mehmanSubmittedAttending = submittedAttending.filter((m) => m.local_mehman === "Mehman");
  const missingData = {
    no_whatsapp: submittedAttending.filter((m) => !m.whatsapp_e164).length,
    no_email: submittedAttending.filter((m) => !m.email).length,
    no_arrival: mehmanSubmittedAttending.filter((m) => !m.arrival_at).length,
    no_airport: mehmanSubmittedAttending.filter((m) => !m.airport).length,
    no_flight_no: mehmanSubmittedAttending.filter((m) => !m.arrival_flight_no).length,
  };

  // ── Roster data quality (applies to whole roster, not just submitted) ─────────
  const dataQuality = {
    no_full_name: members.filter((m) => !m.full_name?.trim()).length,
    no_local_mehman: members.filter((m) => !m.local_mehman?.trim()).length,
  };

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    filters: { local_mehman: localMehmanFilter, status: statusFilter, attending: attendingFilter, gender: genderFilter },
    summary: {
      total_families: totalFamilies,
      filtered_families: fams.length,
      submitted_families: submittedFamilies,
      pending_families: pendingFamilies,
      total_mumineen: members.length,
      submitted_mumineen: submittedMumineen,
      pending_mumineen: pendingMumineen,
      attending: attending.length,
      not_attending: notAttending,
      local: localCount,
      mehman: mehmanCount,
      adults: members.filter((m) => m.is_adult).length,
      minors: members.filter((m) => !m.is_adult).length,
    },
    timeline,
    accommodation: {
      hotel: hotelFams,
      hotel_people: hotelPeople,
      utaro: utaroFams,
      utaro_people: utaroPeople,
      open_to_utaro: openToUtaro,
      open_to_utaro_people: openToUtaroPeople,
      not_set: accNotSet,
      top_hotels: topHotels,
      hosts,
    },
    transport,
    airports,
    arrivals_by_date: arrivalsByDate,
    arrivals_by_datetime: arrivalsByDatetime,
    departures_by_date: departuresByDate,
    gender,
    age_groups: ageGroups,
    khidmat: {
      wants: wantsKhidmat,
      not_wants: notKhidmat,
      not_set: khidmatNotSet,
      by_department: khidmatByDept,
    },
    accessibility,
    missing_data: missingData,
    data_quality: dataQuality,
  });
}
