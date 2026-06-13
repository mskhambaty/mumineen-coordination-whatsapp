import { NextRequest, NextResponse } from "next/server";

import { canManageParking, canViewParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import {
  buildHouseholdRow,
  matchesFilters,
  type HouseholdFilters,
  type PassInfo,
  type RollupFamily,
  type RollupMember,
} from "@/lib/parking/rollups";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// PostgREST caps responses at 1000 rows; page through (same helper as registration-analytics).
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

type FamilyRow = RollupFamily & { roster_active: boolean };
type PassRow = { id: string; family_id: string; lot_id: string; notes: string | null };
type LotRow = { id: string; name: string; color: string | null };

// GET /api/admin/parking/households — one row per roster household with criteria
// rollups (rahat/senior, all-65+, categories, kids under 7) and current passes.
// Filters come as query params and are applied server-side via matchesFilters.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewParking);
  if (auth instanceof NextResponse) return auth;
  const canManage = auth.caller.portal ? canManageParking(auth.caller.portal) : false;

  const { searchParams } = new URL(req.url);

  // Tri-state helper: "1" → true, "0" → false, absent → undefined (no filter).
  function tri(key: string): boolean | undefined {
    const v = searchParams.get(key);
    return v === "1" ? true : v === "0" ? false : undefined;
  }

  const filters: HouseholdFilters = {
    eligible: tri("eligible"),
    local_mehman: searchParams.get("local_mehman") ?? "",
    filterMode: searchParams.get("filter_mode") === "or" ? "or" : "and",
    any_rahat: tri("any_rahat"),
    any_senior: tri("any_senior"),
    all_rahat: tri("all_rahat"),
    all_65: tri("all_65"),
    wheelchair: tri("wheelchair"),
    has_phone: tri("has_phone"),
    has_category: tri("has_category"),
    kids_under_7: tri("kids_under_7"),
    assigned: (searchParams.get("assigned") ?? "") as HouseholdFilters["assigned"],
    q: searchParams.get("q") ?? "",
  };

  const supabase = getSupabaseAdmin();
  const [families, members, passes, lots] = await Promise.all([
    fetchAll<FamilyRow>((from, to) =>
      supabase
        .from("families")
        .select("id, hof_its, transport_mode, utaro_host_its, roster_active")
        .eq("roster_active", true)
        .order("hof_its")
        .range(from, to),
    ),
    fetchAll<RollupMember>((from, to) =>
      supabase
        .from("mumineen")
        .select("hof_its, is_head, full_name, whatsapp_e164, local_mehman, age, category, rahat_seating, wheelchair, not_attending")
        .eq("roster_active", true)
        .order("its")
        .range(from, to),
    ),
    fetchAll<PassRow>((from, to) =>
      supabase.from("parking_passes").select("id, family_id, lot_id, notes").order("created_at").range(from, to),
    ),
    fetchAll<LotRow>((from, to) =>
      supabase.from("parking_lots").select("id, name, color").range(from, to),
    ),
  ]);

  const lotById = new Map(lots.map((l) => [l.id, l]));
  const passesByFamily = new Map<string, PassInfo[]>();
  for (const p of passes) {
    const lot = lotById.get(p.lot_id);
    const info: PassInfo = {
      id: p.id,
      lot_id: p.lot_id,
      lot_name: lot?.name ?? "Unknown",
      lot_color: lot?.color ?? null,
      notes: p.notes,
    };
    const list = passesByFamily.get(p.family_id);
    if (list) {
      list.push(info);
    } else {
      passesByFamily.set(p.family_id, [info]);
    }
  }

  const membersByHof = new Map<string, RollupMember[]>();
  for (const m of members) {
    const list = membersByHof.get(m.hof_its);
    if (list) {
      list.push(m);
    } else {
      membersByHof.set(m.hof_its, [m]);
    }
  }

  // Attending headcount per family — needed to compute effective pass count for utaro hosts.
  const famAttending = new Map<string, number>();
  for (const [hofIts, mems] of membersByHof) {
    famAttending.set(hofIts, mems.filter((m) => !m.not_attending).length);
  }

  // Map host hof_its → list of guest families staying there. Members are included so
  // commute guests' criteria (rahat, age, etc.) roll up into the host's row.
  const hostGuests = new Map<string, { attendingCount: number; transport_mode: string | null; members: RollupMember[] }[]>();
  for (const f of families) {
    const hostIts = f.utaro_host_its?.trim();
    if (!hostIts) continue;
    const entry = {
      attendingCount: famAttending.get(f.hof_its) ?? 0,
      transport_mode: f.transport_mode,
      members: membersByHof.get(f.hof_its) ?? [],
    };
    const list = hostGuests.get(hostIts);
    if (list) list.push(entry);
    else hostGuests.set(hostIts, [entry]);
  }

  // Set of all hof_its values that exist as active families in this load.
  // Used to detect "orphaned" utaro guests whose host is not in the system.
  const knownFamilyIts = new Set(families.map((f) => f.hof_its));

  const rows = families
    .map((f) => {
      const row = buildHouseholdRow(
        f,
        membersByHof.get(f.hof_its) ?? [],
        passesByFamily.get(f.id) ?? [],
        hostGuests.get(f.hof_its) ?? [],
      );

      // If this family is commuting with a utaro host that doesn't exist in the
      // system, they can't roll up into the host's row. Treat them as eligible
      // for their own pass so they aren't hidden from the default view.
      const hostMissing =
        f.utaro_host_its?.trim() && !knownFamilyIts.has(f.utaro_host_its.trim());
      if (hostMissing && !row.eligible && row.member_count > 0) {
        return { ...row, eligible: true, suggested_passes: Math.max(row.suggested_passes, 1) };
      }

      return row;
    })
    .filter((r) => r.member_count > 0);

  const filtered = rows.filter((r) => matchesFilters(r, filters)).sort((a, b) => a.head_name.localeCompare(b.head_name));

  return NextResponse.json({
    rows: filtered,
    total: rows.length,
    can_manage: canManage,
  });
}
