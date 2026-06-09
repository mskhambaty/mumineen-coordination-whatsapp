import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { canViewRegistrations } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MuminRow = {
  its: string;
  full_name: string | null;
  hof_its: string;
  gender: string | null;
  age: number | null;
  local_mehman: string | null;
  arrival_at: string | null;
  arrival_flight_no: string | null;
  airport: string | null;
  not_attending: boolean | null;
};

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

function fmtDatetime(arrival_at: string | null): { date: string; time: string } {
  if (!arrival_at) return { date: "", time: "" };
  const date = arrival_at.slice(0, 10);
  const hasTime = arrival_at.length > 10 && (arrival_at[10] === "T" || arrival_at[10] === " ");
  if (!hasTime) return { date, time: "" };
  const h = parseInt(arrival_at.slice(11, 13), 10);
  const min = arrival_at.slice(14, 16);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { date, time: `${h12}:${min} ${ampm}` };
}

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewRegistrations);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();

  const members = await fetchAll<MuminRow>((from, to) =>
    supabase
      .from("mumineen")
      .select("its, full_name, hof_its, gender, age, local_mehman, arrival_at, arrival_flight_no, airport, not_attending")
      .eq("roster_active", true)
      .range(from, to),
  );

  const mehmanArriving = members.filter(
    (m) => m.local_mehman === "Mehman" && !m.not_attending && m.arrival_at,
  );

  // Sort by arrival_at so rows are grouped by date+time naturally
  mehmanArriving.sort((a, b) => (a.arrival_at ?? "").localeCompare(b.arrival_at ?? ""));

  const rows = mehmanArriving.map((m) => {
    const { date, time } = fmtDatetime(m.arrival_at);
    return {
      ITS: m.its,
      "HOF ITS": m.hof_its,
      Name: m.full_name ?? "",
      Age: m.age ?? "",
      Gender: m.gender ?? "",
      "Arrival Date": date,
      "Arrival Time": time,
      Airport: m.airport ?? "",
      "Flight No": m.arrival_flight_no ?? "",
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, // ITS
    { wch: 12 }, // HOF ITS
    { wch: 28 }, // Name
    { wch: 6 },  // Age
    { wch: 10 }, // Gender
    { wch: 14 }, // Arrival Date
    { wch: 12 }, // Arrival Time
    { wch: 8 },  // Airport
    { wch: 12 }, // Flight No
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Arrivals");

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="mehman-arrivals.xlsx"',
    },
  });
}
