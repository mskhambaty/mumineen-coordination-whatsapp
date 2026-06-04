import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/mumineen/search?q=<term> — lookup roster members by ITS, name, phone, HOF ITS, jamaat, or category.
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Escape PostgREST or-filter metacharacters in the user term.
  const safe = q.replace(/[%,()]/g, " ");
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mumineen")
    .select(
      "its, full_name, gender, age, jamaat, city, hof_its, is_head, whatsapp_e164, email, " +
        "idara, category, prefix, title, venue, local_mehman, is_adult, " +
        "arrival_at, arrival_flight_no, departure_at, departure_flight_no, airport, daily_trans, roster_arrival_raw, roster_flight_code, " +
        "rahat_seating, wheelchair, special_needs, wants_khidmat, not_attending, whatsapp_link_clicked, updated_at, " +
        "family:families!mumineen_family_id_fkey(registration_status, submitted_at, submitted_by_its, acc_type, hotel_name, hotel_address, open_to_utaro, utaro_host_name, utaro_host_its, utaro_host_address, utaro_host_whatsapp_e164, utaro_host_email, transport_mode, transport_detail, cancelled_at, cancelled_reason)",
    )
    .eq("roster_active", true)
    .or(`its.ilike.%${safe}%,full_name.ilike.%${safe}%,whatsapp_e164.ilike.%${safe}%,hof_its.ilike.%${safe}%,jamaat.ilike.%${safe}%,category.ilike.%${safe}%`)
    .order("is_head", { ascending: false })
    .order("full_name", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ results: data ?? [] });
}
