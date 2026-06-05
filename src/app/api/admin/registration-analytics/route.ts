import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MuminRow = {
  its: string;
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
};

type DeptRow = { id: string; name: string };

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const [{ data: mumineen }, { data: families }, { data: departments }] =
    await Promise.all([
      supabase
        .from("mumineen")
        .select(
          "its, hof_its, gender, age, is_adult, is_head, local_mehman, arrival_at, departure_at, arrival_flight_no, airport, not_attending, rahat_seating, wheelchair, special_needs, wants_khidmat, khidmat_department_ids, whatsapp_e164, email",
        )
        .eq("roster_active", true),
      supabase
        .from("families")
        .select(
          "hof_its, registration_status, acc_type, hotel_name, open_to_utaro, transport_mode, submitted_at",
        )
        .eq("roster_active", true),
      supabase.from("departments").select("id, name").order("name"),
    ]);

  const members = (mumineen ?? []) as MuminRow[];
  const fams = (families ?? []) as FamilyRow[];
  const depts = (departments ?? []) as DeptRow[];
  const deptMap = new Map(depts.map((d) => [d.id, d.name]));

  // Build a fast lookup: hof_its → registration_status
  const famStatusMap = new Map(fams.map((f) => [f.hof_its, f.registration_status ?? "pending"]));
  const isSubmitted = (hofIts: string) => {
    const s = famStatusMap.get(hofIts);
    return s === "submitted" || s === "confirmed";
  };

  // --- Summary ---
  const totalFamilies = fams.length;
  const submittedFamilies = fams.filter(
    (f) => f.registration_status === "submitted" || f.registration_status === "confirmed",
  ).length;
  const confirmedFamilies = fams.filter((f) => f.registration_status === "confirmed").length;
  const pendingFamilies = fams.filter(
    (f) => !f.registration_status || f.registration_status === "pending",
  ).length;
  const cancelledFamilies = fams.filter((f) => f.registration_status === "cancelled").length;

  const attending = members.filter((m) => !m.not_attending);
  const notAttending = members.filter((m) => m.not_attending).length;
  const localCount = members.filter((m) => m.local_mehman === "Local").length;
  const mehmanCount = members.filter((m) => m.local_mehman === "Mehman").length;

  // --- Registration timeline ---
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

  // --- Accommodation (registered families only) ---
  const registeredFams = fams.filter(
    (f) => f.registration_status === "submitted" || f.registration_status === "confirmed",
  );
  const hotelFams = registeredFams.filter((f) => f.acc_type === "hotel").length;
  const utaroFams = registeredFams.filter((f) => f.acc_type === "utaro").length;
  const openToUtaro = registeredFams.filter((f) => f.open_to_utaro).length;
  const accNotSet = registeredFams.filter((f) => !f.acc_type).length;

  const hotelCounts = new Map<string, number>();
  for (const f of registeredFams) {
    if (f.acc_type === "hotel" && f.hotel_name?.trim()) {
      const name = f.hotel_name.trim();
      hotelCounts.set(name, (hotelCounts.get(name) ?? 0) + 1);
    }
  }
  const topHotels = Array.from(hotelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // --- Transport ---
  const transport = {
    rideshare: registeredFams.filter((f) => f.transport_mode === "rideshare").length,
    rental: registeredFams.filter((f) => f.transport_mode === "rental").length,
    commute_with_utaro: registeredFams.filter((f) => f.transport_mode === "commute_with_utaro").length,
    other: registeredFams.filter((f) => f.transport_mode === "other").length,
    not_set: registeredFams.filter((f) => !f.transport_mode).length,
  };

  // --- Airport & travel (attending mehman) ---
  const mehmanAttending = members.filter((m) => m.local_mehman === "Mehman" && !m.not_attending);
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
    const depField = (m as MuminRow & { departure_at?: string | null }).departure_at;
    if (depField) {
      const day = depField.slice(0, 10);
      departureMap.set(day, (departureMap.get(day) ?? 0) + 1);
    }
  }
  const arrivalsByDate = Array.from(arrivalMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
  const departuresByDate = Array.from(departureMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  // --- Gender (attending members) ---
  const genderMap = new Map<string, number>();
  for (const m of attending) {
    const g = m.gender?.trim() ?? "Unknown";
    genderMap.set(g, (genderMap.get(g) ?? 0) + 1);
  }
  const gender = Array.from(genderMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));

  // --- Age groups (attending members) ---
  const ageGroups = {
    under_12: attending.filter((m) => m.age !== null && m.age < 12).length,
    teen_12_17: attending.filter((m) => m.age !== null && m.age >= 12 && m.age <= 17).length,
    adult_18_59: attending.filter((m) => m.age !== null && m.age >= 18 && m.age <= 59).length,
    senior_60_plus: attending.filter((m) => m.age !== null && m.age >= 60).length,
    unknown: attending.filter((m) => m.age === null).length,
  };

  // --- Khidmat ---
  const khidmatPool = members.filter((m) => !m.not_attending && m.local_mehman === "Mehman");
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

  // --- Accessibility ---
  const accessibility = {
    rahat_seating: attending.filter((m) => m.rahat_seating).length,
    wheelchair: attending.filter((m) => m.wheelchair).length,
    special_needs: attending.filter((m) => m.special_needs?.trim()).length,
  };

  // --- Missing data (submitted families, attending members only) ---
  const submittedAttending = attending.filter((m) => isSubmitted(m.hof_its));
  const mehmanSubmittedAttending = submittedAttending.filter((m) => m.local_mehman === "Mehman");
  const missingData = {
    no_whatsapp: submittedAttending.filter((m) => !m.whatsapp_e164).length,
    no_email: submittedAttending.filter((m) => !m.email).length,
    no_arrival: mehmanSubmittedAttending.filter((m) => !m.arrival_at).length,
    no_airport: mehmanSubmittedAttending.filter((m) => !m.airport).length,
    no_flight_no: mehmanSubmittedAttending.filter((m) => !m.arrival_flight_no).length,
  };

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    summary: {
      total_families: totalFamilies,
      submitted_families: submittedFamilies,
      confirmed_families: confirmedFamilies,
      pending_families: pendingFamilies,
      cancelled_families: cancelledFamilies,
      total_mumineen: members.length,
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
      utaro: utaroFams,
      open_to_utaro: openToUtaro,
      not_set: accNotSet,
      top_hotels: topHotels,
    },
    transport,
    airports,
    arrivals_by_date: arrivalsByDate,
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
  });
}
