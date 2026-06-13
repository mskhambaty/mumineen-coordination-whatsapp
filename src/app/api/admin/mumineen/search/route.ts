import { NextRequest, NextResponse } from "next/server";

import { canAccessMumineen, canImportMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MEMBER_SELECT =
  "its, full_name, gender, age, jamaat, city, hof_its, is_head, roster_active, whatsapp_e164, email, " +
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
// GET /api/admin/mumineen/search?utaro_host=<term> — find all mehman families whose utaro host
// ITS or utaro host name matches the term. Returns their members like a normal search.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const utaroHost = (req.nextUrl.searchParams.get("utaro_host") ?? "").trim();
  if (q.length < 2 && utaroHost.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Deactivated families are normally invisible to every read. Privileged callers (the same tier
  // that can bulk-import/deactivate) may opt into seeing them with ?include_inactive=1, so they can
  // find and re-activate a family from the UI. The param is silently ignored for everyone else.
  const includeInactive =
    req.nextUrl.searchParams.get("include_inactive") === "1" && canImportMumineen(auth.caller.portal);

  const supabase = getSupabaseAdmin();
  let hofsToFetch: string[] = [];
  let truncated = false;

  if (utaroHost.length >= 2) {
    // Search families by utaro_host_its or utaro_host_name.
    const safeHost = utaroHost.replace(/[%,()]/g, " ");
    const { data: fams, error: famErr } = await supabase
      .from("families")
      .select("hof_its")
      .or(`utaro_host_its.ilike.%${safeHost}%,utaro_host_name.ilike.%${safeHost}%`)
      .limit(MAX_FAMILIES + 1);
    if (famErr) return NextResponse.json({ error: famErr.message }, { status: 500 });
    const all = (fams ?? []).map((f: { hof_its: string }) => f.hof_its).filter(Boolean);
    truncated = all.length > MAX_FAMILIES;
    hofsToFetch = all.slice(0, MAX_FAMILIES);
  } else {
    // Escape PostgREST or-filter metacharacters in the user term.
    const safe = q.replace(/[%,()]/g, " ");

    // Step 1 — find which families match the term (by any member field or the family's HOF ITS).
    let matchQuery = supabase.from("mumineen").select("hof_its, is_head, full_name");
    if (!includeInactive) {
      matchQuery = matchQuery.eq("roster_active", true);
    }
    const { data: matches, error: matchError } = await matchQuery
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
    truncated = familyHofs.length > MAX_FAMILIES;
    hofsToFetch = familyHofs.slice(0, MAX_FAMILIES);
  }

  if (hofsToFetch.length === 0) {
    return NextResponse.json({ results: [], truncated: false });
  }

  // Step 2 — fetch every active member of the matched families, grouped by family with the
  // roster head (or, lacking one, the eldest) first.
  let fetchQuery = supabase.from("mumineen").select(MEMBER_SELECT);
  if (!includeInactive) {
    fetchQuery = fetchQuery.eq("roster_active", true);
  }
  const { data, error } = await fetchQuery
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
