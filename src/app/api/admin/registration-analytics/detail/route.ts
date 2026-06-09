import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { isRegisteredStatus, matchesStatusFilter } from "@/lib/registration/status";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Paginate through all rows, bypassing PostgREST's 1000-row default cap.
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

type MuminDetail = {
  its: string;
  full_name: string | null;
  gender: string | null;
  age: number | null;
  is_adult: boolean | null;
  is_head: boolean;
  hof_its: string;
  local_mehman: string | null;
  whatsapp_e164: string | null;
  email: string | null;
  not_attending: boolean;
  arrival_at: string | null;
  departure_at: string | null;
  arrival_flight_no: string | null;
  airport: string | null;
  rahat_seating: boolean | null;
  wheelchair: boolean | null;
  special_needs: string | null;
  wants_khidmat: boolean | null;
  khidmat_department_ids: string[] | null;
};

type FamilyDetail = {
  hof_its: string;
  registration_status: string | null;
  acc_type: string | null;
  hotel_name: string | null;
  open_to_utaro: boolean | null;
  transport_mode: string | null;
  transport_detail: string | null;
  submitted_at: string | null;
  utaro_host_name: string | null;
  utaro_host_its: string | null;
  utaro_host_address: string | null;
  utaro_host_whatsapp_e164: string | null;
  utaro_host_email: string | null;
};

// Normalized row sent to the client — flat, display-ready.
export type DetailRow = {
  its: string;
  name: string;
  gender: string;
  age: string;
  local_mehman: string;
  whatsapp: string;
  email: string;
  detail: string; // segment-specific field(s)
  hof_its: string;
  head?: string; // "Head" (roster HoF) | "Acting head" (registrant when HoF unregistered) | "" — only set for individual-level segments
  attending?: string; // "Yes" | "No" — only set for individual-level segments
  utaro_host_name?: string;
  utaro_host_its?: string;
  utaro_host_whatsapp?: string;
  utaro_host_email?: string;
  utaro_host_address?: string;
};

export async function GET(req: NextRequest) {
  // Per-person drill-down rows carry ITS, full name, phone, and email across the
  // whole roster, so the detail view + its CSV export are admin/leadership only —
  // even though the headline KPI counts (/registration-analytics) are open to all
  // portal users.
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const segment = searchParams.get("segment") ?? "";
  const value = searchParams.get("value") ?? "";
  const localMehmanFilter = searchParams.get("local_mehman");
  const statusFilter = searchParams.get("status");
  const attendingFilter = searchParams.get("attending");

  const supabase = getSupabaseAdmin();

  const MUMIN_SELECT =
    "its, full_name, gender, age, is_adult, is_head, hof_its, local_mehman, whatsapp_e164, email, not_attending, arrival_at, departure_at, arrival_flight_no, airport, rahat_seating, wheelchair, special_needs, wants_khidmat, khidmat_department_ids";

  const FAMILY_SELECT =
    "hof_its, registration_status, acc_type, hotel_name, open_to_utaro, transport_mode, transport_detail, submitted_at, utaro_host_name, utaro_host_its, utaro_host_address, utaro_host_whatsapp_e164, utaro_host_email";

  const isFamilySegment = ["hotel", "transport", "acc_type", "registration_status", "host"].includes(segment);

  let rows: DetailRow[] = [];

  if (segment === "open_to_utaro") {
    // The awaiting-utaro matching pool, exported at the INDIVIDUAL level so the accommodation
    // team sees every member's gender/age and can pivot families themselves via hof_its.
    // Registered (submitted/confirmed) + hotel-booked + open to a host. Optional value narrows to one hotel.
    const fams = await fetchAll<{
      hof_its: string;
      registration_status: string | null;
      acc_type: string | null;
      hotel_name: string | null;
      open_to_utaro: boolean | null;
      submitted_by_its: string | null;
    }>((from, to) =>
      supabase
        .from("families")
        .select("hof_its, registration_status, acc_type, hotel_name, open_to_utaro, submitted_by_its")
        .eq("roster_active", true)
        .range(from, to),
    );

    const qualifying = new Map(
      fams
        .filter(
          (f) =>
            isRegisteredStatus(f.registration_status) &&
            f.acc_type === "hotel" &&
            f.open_to_utaro &&
            (value === "" || f.hotel_name?.trim().toLowerCase() === value.toLowerCase()),
        )
        .map((f) => [f.hof_its, f] as const),
    );

    const allMembers = await fetchAll<MuminDetail>((from, to) =>
      supabase.from("mumineen").select(MUMIN_SELECT).eq("roster_active", true).range(from, to),
    );
    const pool = allMembers.filter((m) => qualifying.has(m.hof_its));

    // Resolve the head per family from the full pool (before display filters): the roster HoF
    // (is_head) wins; otherwise the registrant (submitted_by_its) is the acting head — ~430
    // families have no roster HoF, so is_head alone would leave them headless.
    const headItsByHof = new Map<string, string>();
    for (const m of pool) {
      if (m.is_head) {
        headItsByHof.set(m.hof_its, m.its);
      }
    }
    for (const [hof, f] of qualifying) {
      if (!headItsByHof.has(hof) && f.submitted_by_its) {
        headItsByHof.set(hof, f.submitted_by_its);
      }
    }

    // Honor the page's global filters.
    let display = pool;
    if (localMehmanFilter) {
      display = display.filter((m) => m.local_mehman === localMehmanFilter);
    }
    if (attendingFilter === "true") {
      display = display.filter((m) => !m.not_attending);
    }

    // Group families together (by hof_its), head first within each, then by name.
    display = display.slice().sort((a, b) => {
      if (a.hof_its !== b.hof_its) return a.hof_its.localeCompare(b.hof_its);
      const aHead = headItsByHof.get(a.hof_its) === a.its ? 0 : 1;
      const bHead = headItsByHof.get(b.hof_its) === b.its ? 0 : 1;
      if (aHead !== bHead) return aHead - bHead;
      return (a.full_name ?? "").localeCompare(b.full_name ?? "");
    });

    rows = display.map((m) => {
      const fam = qualifying.get(m.hof_its)!;
      const isHeadRow = headItsByHof.get(m.hof_its) === m.its;
      return {
        its: m.its,
        name: m.full_name ?? m.its,
        gender: m.gender?.trim() ?? "—",
        age: m.age !== null ? String(m.age) : "—",
        local_mehman: m.local_mehman ?? "—",
        whatsapp: m.whatsapp_e164 ?? "",
        email: m.email ?? "",
        detail: fam.hotel_name?.trim() ?? "—",
        hof_its: m.hof_its,
        head: isHeadRow ? (m.is_head ? "Head" : "Acting head") : "",
        attending: m.not_attending ? "No" : "Yes",
      };
    });

    return NextResponse.json({ segment, value, count: rows.length, rows });
  }

  if (isFamilySegment) {
    // Family-level segment — fetch families + their HoF name
    const allFams = await fetchAll<FamilyDetail>((from, to) =>
      supabase
        .from("families")
        .select(FAMILY_SELECT)
        .eq("roster_active", true)
        .range(from, to),
    );

    // Fetch names for all roster members so families whose head isn't imported still get a name.
    // Prefer the head (is_head=true) — if absent, fall back to any member of that family.
    const allHofs = await fetchAll<{ its: string; hof_its: string; full_name: string | null; whatsapp_e164: string | null; local_mehman: string | null; is_head: boolean; not_attending: boolean }>((from, to) =>
      supabase
        .from("mumineen")
        .select("its, hof_its, full_name, whatsapp_e164, local_mehman, is_head, not_attending")
        .eq("roster_active", true)
        .range(from, to),
    );
    // Build map keyed by hof_its; head wins over non-head.
    const hofMap = new Map<string, { full_name: string | null; whatsapp_e164: string | null; local_mehman: string | null }>();
    for (const m of allHofs) {
      if (!hofMap.has(m.hof_its) || m.is_head) {
        hofMap.set(m.hof_its, { full_name: m.full_name, whatsapp_e164: m.whatsapp_e164, local_mehman: m.local_mehman });
      }
    }
    // Attending headcount per family (roster members not flagged not_attending). Surfaced on the
    // registration_status drill so committee can export attendance per household.
    const attendingByHof = new Map<string, number>();
    for (const m of allHofs) {
      if (!m.not_attending) attendingByHof.set(m.hof_its, (attendingByHof.get(m.hof_its) ?? 0) + 1);
    }

    let fams = allFams;

    // Apply family filters
    if (statusFilter) {
      fams = fams.filter((f) => matchesStatusFilter(f.registration_status, statusFilter));
    }

    if (localMehmanFilter) {
      const mehmanHofs = new Set(
        allHofs.filter((h) => h.local_mehman === localMehmanFilter).map((h) => h.hof_its),
      );
      fams = fams.filter((f) => mehmanHofs.has(f.hof_its));
    }

    // Apply segment filter
    if (segment === "hotel") {
      fams = fams.filter((f) => f.acc_type === "hotel" && (value === "" || f.hotel_name?.trim().toLowerCase() === value.toLowerCase()));
    } else if (segment === "acc_type") {
      fams = fams.filter((f) => f.acc_type === value);
    } else if (segment === "transport") {
      fams = fams.filter((f) => (f.transport_mode ?? "") === value);
    } else if (segment === "registration_status") {
      fams = fams.filter((f) => matchesStatusFilter(f.registration_status, value));
    } else if (segment === "host") {
      // value is the host key from the analytics response: "its:<its>" or "name:<normalized name>".
      fams = fams.filter((f) => {
        if (!isRegisteredStatus(f.registration_status)) return false;
        if (f.acc_type !== "utaro") return false;
        const its = f.utaro_host_its?.trim();
        const normName = (f.utaro_host_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const key = its ? `its:${its}` : normName ? `name:${normName}` : null;
        return key === value;
      });
    }

    // Sort: submitted families by submitted_at desc; others by hof name
    fams = fams.slice().sort((a, b) => {
      if (a.submitted_at && b.submitted_at) return b.submitted_at.localeCompare(a.submitted_at);
      return (hofMap.get(a.hof_its)?.full_name ?? "").localeCompare(hofMap.get(b.hof_its)?.full_name ?? "");
    });

    rows = fams.map((f) => {
      const hof = hofMap.get(f.hof_its);
      let detail = "";
      if (segment === "hotel") detail = f.hotel_name?.trim() ?? "—";
      else if (segment === "acc_type") detail = f.acc_type ?? "—";
      else if (segment === "transport") detail = [f.transport_mode, f.transport_detail].filter(Boolean).join(" — ");
      else if (segment === "registration_status") detail = f.submitted_at ? `Submitted ${f.submitted_at.slice(0, 10)}` : "Not submitted";
      else if (segment === "host")
        detail = [f.utaro_host_name?.trim(), f.utaro_host_its?.trim() ? `ITS ${f.utaro_host_its.trim()}` : null]
          .filter(Boolean)
          .join(" · ");
      // For the utaro acc_type drill, show host name + address instead of the bare type.
      if (segment === "acc_type" && f.acc_type === "utaro" && f.utaro_host_name) {
        detail = [f.utaro_host_name, f.utaro_host_address].filter(Boolean).join(" · ");
      }
      return {
        its: f.hof_its,
        name: hof?.full_name ?? f.hof_its,
        gender: "—",
        age: "—",
        local_mehman: hof?.local_mehman ?? "—",
        whatsapp: hof?.whatsapp_e164 ?? "",
        email: "",
        detail,
        hof_its: f.hof_its,
        // Attending headcount for the family — only on the registration_status (registered/pending)
        // drill, where committee wants per-household attendance in the export.
        attending: segment === "registration_status" ? String(attendingByHof.get(f.hof_its) ?? 0) : undefined,
        // Pass utaro host fields through for the panel to render separately
        utaro_host_name: f.utaro_host_name ?? undefined,
        utaro_host_its: f.utaro_host_its ?? undefined,
        utaro_host_whatsapp: f.utaro_host_whatsapp_e164 ?? undefined,
        utaro_host_email: f.utaro_host_email ?? undefined,
        utaro_host_address: f.utaro_host_address ?? undefined,
      };
    });
  } else {
    // Member-level segment
    let allMembers = await fetchAll<MuminDetail>((from, to) =>
      supabase
        .from("mumineen")
        .select(MUMIN_SELECT)
        .eq("roster_active", true)
        .range(from, to),
    );

    // Fetch HoF family statuses for submitted filter
    let submittedHofIts: Set<string> | null = null;
    if (statusFilter || segment.startsWith("missing_")) {
      const allFams = await fetchAll<{ hof_its: string; registration_status: string | null }>((from, to) =>
        supabase
          .from("families")
          .select("hof_its, registration_status")
          .eq("roster_active", true)
          .range(from, to),
      );
      if (statusFilter) {
        const filtered = allFams.filter((f) => matchesStatusFilter(f.registration_status, statusFilter));
        submittedHofIts = new Set(filtered.map((f) => f.hof_its));
      } else if (segment.startsWith("missing_")) {
        submittedHofIts = new Set(
          allFams.filter((f) => isRegisteredStatus(f.registration_status)).map((f) => f.hof_its),
        );
      }
    }

    // Department lookup for khidmat labels
    let deptMap = new Map<string, string>();
    if (segment === "khidmat_dept" || segment === "wants_khidmat") {
      const { data: depts } = await supabase.from("departments").select("id, name");
      deptMap = new Map((depts ?? []).map((d: { id: string; name: string }) => [d.id, d.name]));
    }

    // Global member filters
    if (localMehmanFilter) allMembers = allMembers.filter((m) => m.local_mehman === localMehmanFilter);
    if (attendingFilter === "true") allMembers = allMembers.filter((m) => !m.not_attending);
    if (submittedHofIts && statusFilter) {
      allMembers = allMembers.filter((m) => submittedHofIts!.has(m.hof_its));
    }

    // Apply segment filter
    let filtered = allMembers;
    switch (segment) {
      case "not_attending":
        filtered = allMembers.filter((m) => m.not_attending);
        break;
      case "attending":
        filtered = allMembers.filter((m) => !m.not_attending);
        break;
      case "local_mehman":
        filtered = allMembers.filter((m) => !m.not_attending && m.local_mehman === value);
        break;
      case "special_needs":
        filtered = allMembers.filter((m) => m.special_needs?.trim());
        break;
      case "rahat_seating":
        filtered = allMembers.filter((m) => m.rahat_seating);
        break;
      case "wheelchair":
        filtered = allMembers.filter((m) => m.wheelchair);
        break;
      case "airport":
        if (value === "not_set") {
          filtered = allMembers.filter((m) => m.local_mehman === "Mehman" && !m.not_attending && !m.airport);
        } else {
          filtered = allMembers.filter((m) => m.local_mehman === "Mehman" && !m.not_attending && m.airport === value);
        }
        break;
      case "arrival_date":
        filtered = allMembers.filter(
          (m) => m.local_mehman === "Mehman" && !m.not_attending && m.arrival_at?.startsWith(value),
        );
        break;
      case "departure_date":
        filtered = allMembers.filter(
          (m) => m.local_mehman === "Mehman" && !m.not_attending && m.departure_at?.startsWith(value),
        );
        break;
      case "wants_khidmat":
        filtered = allMembers.filter((m) => m.local_mehman === "Mehman" && !m.not_attending && m.wants_khidmat === true);
        break;
      case "khidmat_dept":
        filtered = allMembers.filter(
          (m) =>
            m.local_mehman === "Mehman" &&
            !m.not_attending &&
            m.wants_khidmat === true &&
            m.khidmat_department_ids?.includes(value),
        );
        break;
      case "gender":
        filtered = allMembers.filter((m) => !m.not_attending && (m.gender?.trim() ?? "Unknown") === value);
        break;
      case "age_group":
        filtered = allMembers.filter((m) => {
          if (m.not_attending) return false;
          if (value === "age_0_5") return m.age !== null && m.age <= 5;
          if (value === "age_6_11") return m.age !== null && m.age >= 6 && m.age <= 11;
          if (value === "age_12_17") return m.age !== null && m.age >= 12 && m.age <= 17;
          if (value === "age_18_39") return m.age !== null && m.age >= 18 && m.age <= 39;
          if (value === "age_40_59") return m.age !== null && m.age >= 40 && m.age <= 59;
          if (value === "age_60_plus") return m.age !== null && m.age >= 60;
          if (value === "unknown") return m.age === null;
          return false;
        });
        break;
      case "missing_whatsapp":
        filtered = allMembers.filter(
          (m) => !m.not_attending && submittedHofIts!.has(m.hof_its) && !m.whatsapp_e164,
        );
        break;
      case "missing_email":
        filtered = allMembers.filter(
          (m) => !m.not_attending && submittedHofIts!.has(m.hof_its) && !m.email,
        );
        break;
      case "missing_arrival":
        filtered = allMembers.filter(
          (m) =>
            m.local_mehman === "Mehman" &&
            !m.not_attending &&
            submittedHofIts!.has(m.hof_its) &&
            !m.arrival_at,
        );
        break;
      case "missing_airport":
        filtered = allMembers.filter(
          (m) =>
            m.local_mehman === "Mehman" &&
            !m.not_attending &&
            submittedHofIts!.has(m.hof_its) &&
            !m.airport,
        );
        break;
      case "missing_flight":
        filtered = allMembers.filter(
          (m) =>
            m.local_mehman === "Mehman" &&
            !m.not_attending &&
            submittedHofIts!.has(m.hof_its) &&
            !m.arrival_flight_no,
        );
        break;
      case "no_full_name":
        filtered = allMembers.filter((m) => !m.full_name?.trim());
        break;
      case "no_local_mehman":
        filtered = allMembers.filter((m) => !m.local_mehman?.trim());
        break;
    }

    filtered.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));

    rows = filtered.map((m) => {
      let detail = "";
      switch (segment) {
        case "special_needs":
          detail = m.special_needs?.trim() ?? "";
          break;
        case "airport":
        case "missing_airport":
          detail = m.airport ?? "—";
          break;
        case "arrival_date":
        case "missing_arrival":
          detail = [m.arrival_at?.slice(0, 10), m.arrival_flight_no, m.airport].filter(Boolean).join(" · ");
          break;
        case "departure_date":
          detail = m.departure_at?.slice(0, 10) ?? "—";
          break;
        case "wants_khidmat":
        case "khidmat_dept":
          detail = (m.khidmat_department_ids ?? []).map((id) => deptMap.get(id) ?? id).join(", ");
          break;
        case "missing_whatsapp":
        case "missing_email":
        case "missing_flight":
          detail = [m.arrival_at?.slice(0, 10), m.arrival_flight_no, m.airport].filter(Boolean).join(" · ");
          break;
        default:
          detail = "";
      }
      return {
        its: m.its,
        name: m.full_name ?? m.its,
        gender: m.gender?.trim() ?? "—",
        age: m.age !== null ? String(m.age) : "—",
        local_mehman: m.local_mehman ?? "—",
        whatsapp: m.whatsapp_e164 ?? "",
        email: m.email ?? "",
        detail,
        hof_its: m.hof_its,
      };
    });
  }

  return NextResponse.json({ segment, value, count: rows.length, rows });
}
