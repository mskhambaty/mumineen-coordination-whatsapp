import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MuminRow = {
  its: string;
  hof_its: string;
  full_name: string | null;
  gender: string | null;
  age: number | null;
  jamaat: string | null;
  idara: string | null;
  category: string | null;
  prefix: string | null;
  title: string | null;
  venue: string | null;
  city: string | null;
  local_mehman: string | null;
  roster_arrival_raw: string | null;
  roster_flight_code: string | null;
  daily_trans: string | null;
  whatsapp_link_clicked: boolean | null;
  whatsapp_e164: string | null;
  email: string | null;
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

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const rows = await fetchAll<MuminRow>((from, to) =>
    supabase
      .from("mumineen")
      .select(
        "its, hof_its, full_name, gender, age, jamaat, idara, category, prefix, title, venue, city, local_mehman, roster_arrival_raw, roster_flight_code, daily_trans, whatsapp_link_clicked, whatsapp_e164, email",
      )
      .eq("roster_active", true)
      .order("hof_its", { ascending: true })
      .order("its", { ascending: true })
      .range(from, to),
  );

  const MIQAAT = "Relay Centers - Ashara Mubaraka";

  const sheetRows = rows.map((m) => ({
    Miqaat: MIQAAT,
    "Hof Id": m.hof_its,
    "Mumin Id": m.its,
    Fullname: m.full_name ?? "",
    Gender: m.gender ?? "",
    Age: m.age ?? "",
    Jamaat: m.jamaat ?? "",
    Idara: m.idara ?? "",
    Category: m.category ?? "",
    Prefix: m.prefix ?? "",
    Title: m.title ?? "",
    "Venue (Waaz)": m.venue ?? "",
    City: m.city ?? "",
    "Local/Mehman": m.local_mehman ?? "",
    "Arr Place Date": m.roster_arrival_raw ?? "",
    "Flight Code": m.roster_flight_code ?? "",
    "Whatsapp Link Clicked?": m.whatsapp_link_clicked === true ? "Yes" : m.whatsapp_link_clicked === false ? "No" : "",
    "Daily Trans": m.daily_trans ?? "",
    "Acc Arranged At": "",
    "Acc. Zone": "",
    whatsapp_e164: m.whatsapp_e164 ?? "",
    email: m.email ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);

  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!cols"] = [
    { wch: 36 }, // Miqaat
    { wch: 12 }, // Hof Id
    { wch: 12 }, // Mumin Id
    { wch: 30 }, // Fullname
    { wch: 8 },  // Gender
    { wch: 6 },  // Age
    { wch: 28 }, // Jamaat
    { wch: 20 }, // Idara
    { wch: 14 }, // Category
    { wch: 10 }, // Prefix
    { wch: 16 }, // Title
    { wch: 16 }, // Venue (Waaz)
    { wch: 22 }, // City
    { wch: 14 }, // Local/Mehman
    { wch: 20 }, // Arr Place Date
    { wch: 14 }, // Flight Code
    { wch: 22 }, // Whatsapp Link Clicked?
    { wch: 14 }, // Daily Trans
    { wch: 18 }, // Acc Arranged At
    { wch: 14 }, // Acc. Zone
    { wch: 18 }, // whatsapp_e164
    { wch: 28 }, // email
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Roster");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="mumineen-roster-${today}.xlsx"`,
    },
  });
}
