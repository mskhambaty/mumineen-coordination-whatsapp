import { NextRequest, NextResponse } from "next/server";

import { canAccessMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MEMBER_SELECT =
  "its, full_name, gender, age, jamaat, city, hof_its, is_head, whatsapp_e164, email, " +
  "idara, category, prefix, title, venue, local_mehman, is_adult, " +
  "arrival_at, arrival_flight_no, departure_at, departure_flight_no, airport, daily_trans, roster_arrival_raw, roster_flight_code, " +
  "rahat_seating, wheelchair, special_needs, wants_khidmat, not_attending, khidmat_department_ids, whatsapp_link_clicked, updated_at, " +
  "family:families!mumineen_family_id_fkey(registration_status, submitted_at, submitted_by_its, acc_type, hotel_name, hotel_address, open_to_utaro, utaro_host_name, utaro_host_its, utaro_host_address, utaro_host_whatsapp_e164, utaro_host_email, transport_mode, transport_detail)";

// Cap how many distinct families a single search expands, to bound broad name matches.
const MAX_FAMILIES = 50;

// GET /api/admin/mumineen/search?q=<term> — lookup roster members by ITS, name, phone, HOF ITS,
// jamaat, or category. Matches are expanded to the WHOLE family: looking up ANY member (not just
// the HOF) surfaces their entire household, since a non-HOF member often reaches out and the
// committee needs to find the full family.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Escape PostgREST or-filter metacharacters in the user term.
  const safe = q.replace(/[%,()]/g, " ");
  const supabase = getSupabaseAdmin();

  // Step 1 — find which families match the term (by any member field or the family's HOF ITS).
  const { data: matches, error: matchError } = await supabase
    .from("mumineen")
    .select("hof_its, is_head, full_name")
    .eq("roster_active", true)
    .or(`its.ilike.%${safe}%,full_name.ilike.%${safe}%,whatsapp_e164.ilike.%${safe}%,hof_its.ilike.%${safe}%,jamaat.ilike.%${safe}%,category.ilike.%${safe}%`)
    .order("is_head", { ascending: false })
    .order("full_name", { ascending: true })
    .limit(200);
  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 });
  }

  const familyHofs: string[] = [];
  const seen = new Set<string>();
  for (const m of (matches ?? []) as { hof_its: string | null }[]) {
    if (m.hof_its && !seen.has(m.hof_its)) {
      seen.add(m.hof_its);
      familyHofs.push(m.hof_its);
    }
  }
  const truncated = familyHofs.length > MAX_FAMILIES;
  const hofsToFetch = familyHofs.slice(0, MAX_FAMILIES);
  if (hofsToFetch.length === 0) {
    return NextResponse.json({ results: [], truncated: false });
  }

  // Step 2 — fetch every active member of the matched families, grouped by family with the
  // roster head (or, lacking one, the eldest) first.
  const { data, error } = await supabase
    .from("mumineen")
    .select(MEMBER_SELECT)
    .eq("roster_active", true)
    .in("hof_its", hofsToFetch)
    .order("hof_its", { ascending: true })
    .order("is_head", { ascending: false })
    .order("age", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mark each family's "acting head": the roster HOF (is_head) if present, else the eldest member.
  // Rows are ordered is_head desc then age desc within each family, so the first row per family is
  // the acting head. Family-level actions (Unregister / Family Not Attending) hang off this row,
  // so they still appear when the real HOF isn't in the roster.
  type Row = { its: string; hof_its: string };
  const members = (data ?? []) as unknown as Row[];
  const actingHeadIts = new Map<string, string>();
  for (const m of members) {
    if (!actingHeadIts.has(m.hof_its)) actingHeadIts.set(m.hof_its, m.its);
  }
  const results = members.map((m) => ({ ...m, is_acting_head: actingHeadIts.get(m.hof_its) === m.its }));

  return NextResponse.json({ results, truncated });
}
