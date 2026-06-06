import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { resolveParkingCaller } from "@/lib/parking/auth";
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
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caller = await resolveParkingCaller(req);
  if (!caller.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const filters: HouseholdFilters = {
    eligible: searchParams.get("eligible") === "1",
    local_mehman: searchParams.get("local_mehman") ?? "",
    rahat_senior: searchParams.get("rahat_senior") === "1",
    all_rahat: searchParams.get("all_rahat") === "1",
    all_65: searchParams.get("all_65") === "1",
    wheelchair: searchParams.get("wheelchair") === "1",
    has_phone: searchParams.get("has_phone") === "1",
    has_category: searchParams.get("has_category") === "1",
    kids_under_7: searchParams.get("kids_under_7") === "1",
    assigned: (searchParams.get("assigned") ?? "") as HouseholdFilters["assigned"],
    q: searchParams.get("q") ?? "",
  };

  const supabase = getSupabaseAdmin();
  const [families, members, passes, lots] = await Promise.all([
    fetchAll<FamilyRow>((from, to) =>
      supabase
        .from("families")
        .select("id, hof_its, transport_mode, roster_active")
        .eq("roster_active", true)
        .order("hof_its")
        .range(from, to),
    ),
    fetchAll<RollupMember>((from, to) =>
      supabase
        .from("mumineen")
        .select("hof_its, is_head, full_name, whatsapp_e164, local_mehman, age, category, rahat_seating, wheelchair")
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

  const rows = families
    .map((f) => buildHouseholdRow(f, membersByHof.get(f.hof_its) ?? [], passesByFamily.get(f.id) ?? []))
    .filter((r) => r.member_count > 0);

  const filtered = rows.filter((r) => matchesFilters(r, filters)).sort((a, b) => a.head_name.localeCompare(b.head_name));

  return NextResponse.json({
    rows: filtered,
    total: rows.length,
    can_manage: caller.canManage,
  });
}
