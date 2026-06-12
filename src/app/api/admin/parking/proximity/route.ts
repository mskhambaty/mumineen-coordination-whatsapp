import { NextRequest, NextResponse } from "next/server";

import { canManageParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { detectProximityIssues, type PassRef } from "@/lib/parking/proximity";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type LotRow = { id: string; name: string; color: string | null; capacity: number; assigned: number };

type LoadedData = {
  byFamily: Map<string, PassRef[]>;
  lotById: Map<string, LotRow>;
};

async function loadData(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<LoadedData> {
  const [{ data: passes, error: passErr }, { data: lots, error: lotErr }] = await Promise.all([
    supabase.from("parking_passes").select("id, family_id, lot_id").order("created_at"),
    supabase.from("parking_lots").select("id, name, color, capacity"),
  ]);
  if (passErr) throw passErr;
  if (lotErr) throw lotErr;

  const assignedCounts = new Map<string, number>();
  for (const p of passes ?? []) {
    assignedCounts.set(p.lot_id, (assignedCounts.get(p.lot_id) ?? 0) + 1);
  }

  const lotById = new Map<string, LotRow>(
    (lots ?? []).map((l: { id: string; name: string; color: string | null; capacity: number | null }) => [
      l.id,
      {
        id: l.id,
        name: l.name,
        color: l.color,
        capacity: l.capacity ?? 0,
        assigned: assignedCounts.get(l.id) ?? 0,
      },
    ]),
  );

  const byFamily = new Map<string, PassRef[]>();
  for (const p of passes ?? []) {
    const lot = lotById.get(p.lot_id);
    const ref: PassRef = { id: p.id, lot_id: p.lot_id, lot_color: lot?.color ?? null };
    const list = byFamily.get(p.family_id);
    if (list) list.push(ref);
    else byFamily.set(p.family_id, [ref]);
  }

  return { byFamily, lotById };
}

// Build a lot-by-color lookup (lowest to highest remaining capacity so we can
// pick the lot with most room when there are multiple lots of the same color).
function buildLotsByColor(lotById: Map<string, LotRow>): Map<string, LotRow[]> {
  const m = new Map<string, LotRow[]>();
  for (const lot of lotById.values()) {
    const key = (lot.color ?? "").toLowerCase();
    const list = m.get(key);
    if (list) list.push(lot);
    else m.set(key, [lot]);
  }
  return m;
}

// Pick the overflow lot for `count` new passes. Prefers primary, falls back
// to fallbackColor when primary is full. Returns { lot, usingFallback, overCapacity }.
function resolveOverflowLot(
  primaryColor: string,
  fallbackColor: string | null,
  lotsByColor: Map<string, LotRow[]>,
): { lot: LotRow | null; usingFallback: boolean; overCapacity: boolean } {
  const byRemaining = (a: LotRow, b: LotRow) =>
    (b.capacity - b.assigned) - (a.capacity - a.assigned);

  const primaryList = (lotsByColor.get(primaryColor) ?? []).sort(byRemaining);
  const primary = primaryList[0] ?? null;
  const primaryOk = primary && (primary.capacity === 0 || primary.assigned < primary.capacity);

  if (primaryOk) return { lot: primary, usingFallback: false, overCapacity: false };

  if (fallbackColor) {
    const fallbackList = (lotsByColor.get(fallbackColor) ?? []).sort(byRemaining);
    const fallback = fallbackList[0] ?? null;
    const fallbackOk = fallback && (fallback.capacity === 0 || fallback.assigned < fallback.capacity);
    if (fallbackOk) return { lot: fallback, usingFallback: true, overCapacity: false };
    return { lot: fallback, usingFallback: true, overCapacity: true };
  }

  // No fallback — use primary even if full (soft-warn).
  return { lot: primary, usingFallback: false, overCapacity: true };
}

// GET /api/admin/parking/proximity
// Returns an audit of all families whose passes violate proximity rules, along
// with the planned target lot for each misallocated pass.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();
  const { byFamily, lotById } = await loadData(supabase);

  const familyIds = [...byFamily.keys()];
  if (familyIds.length === 0) {
    return NextResponse.json({ issues: [], total_families: 0, total_to_revoke: 0 });
  }

  const [{ data: families }, { data: members }] = await Promise.all([
    supabase.from("families").select("id, hof_its").in("id", familyIds),
    supabase
      .from("mumineen")
      .select("hof_its, full_name, is_head")
      .eq("is_head", true),
  ]);

  const hofItsByFamily = new Map(
    (families ?? []).map((f: { id: string; hof_its: string }) => [f.id, f.hof_its]),
  );
  const nameByHofIts = new Map(
    (members ?? []).map((m: { hof_its: string; full_name: string | null }) => [
      m.hof_its,
      m.full_name ?? "",
    ]),
  );

  const rawIssues = detectProximityIssues(
    [...byFamily.entries()].map(([family_id, passes]) => ({ family_id, passes })),
  );

  const lotsByColor = buildLotsByColor(lotById);

  const issues = rawIssues.map((issue) => {
    const hofIts = hofItsByFamily.get(issue.family_id) ?? "";

    const passesForFamily = byFamily.get(issue.family_id) ?? [];
    const anchorLotId = passesForFamily.find((p) => p.id === issue.anchor_pass_id)?.lot_id ?? "";
    const anchorLotName = lotById.get(anchorLotId)?.name ?? "";

    const passesToRevoke = issue.passes_to_revoke.map((passId) => {
      const pass = passesForFamily.find((p) => p.id === passId);
      const lot = pass ? lotById.get(pass.lot_id) : undefined;
      return { id: passId, lot_name: lot?.name ?? "Unknown", lot_color: lot?.color ?? null };
    });

    const { lot: overflowLot, usingFallback, overCapacity } = resolveOverflowLot(
      issue.overflow_primary,
      issue.overflow_fallback,
      lotsByColor,
    );

    return {
      family_id: issue.family_id,
      hof_its: hofIts,
      head_name: nameByHofIts.get(hofIts) ?? hofIts,
      anchor_color: issue.anchor_color,
      anchor_lot_name: anchorLotName,
      passes_to_revoke: passesToRevoke,
      overflow_lot: overflowLot
        ? { id: overflowLot.id, name: overflowLot.name, color: overflowLot.color }
        : null,
      using_fallback: usingFallback,
      over_capacity: overCapacity,
    };
  });

  return NextResponse.json({
    issues,
    total_families: issues.length,
    total_to_revoke: issues.reduce((n, i) => n + i.passes_to_revoke.length, 0),
  });
}

// POST /api/admin/parking/proximity
// Executes the proximity fix: revokes misallocated passes and inserts replacements
// in the correct overflow lot. Processes families sequentially and tracks running
// lot counts so later families reflect updated capacity from earlier fixes.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();
  const { byFamily, lotById } = await loadData(supabase);

  const rawIssues = detectProximityIssues(
    [...byFamily.entries()].map(([family_id, passes]) => ({ family_id, passes })),
  );

  if (rawIssues.length === 0) {
    return NextResponse.json({ ok: true, revoked: 0, assigned: 0, skipped: 0, fallbacks_used: 0 });
  }

  const lotsByColor = buildLotsByColor(lotById);
  const assignedBy = auth.caller.user_id === "admin-api" ? null : auth.caller.user_id;

  let revoked = 0;
  let assigned = 0;
  let skipped = 0;
  let fallbacks_used = 0;

  for (const issue of rawIssues) {
    const { lot: targetLot, usingFallback } = resolveOverflowLot(
      issue.overflow_primary,
      issue.overflow_fallback,
      lotsByColor,
    );

    if (!targetLot) {
      skipped += issue.passes_to_revoke.length;
      continue;
    }

    if (usingFallback) fallbacks_used += issue.passes_to_revoke.length;

    // Revoke misallocated passes.
    const { error: revokeErr, count: revokedCount } = await supabase
      .from("parking_passes")
      .delete({ count: "exact" })
      .in("id", issue.passes_to_revoke);

    if (revokeErr) {
      skipped += issue.passes_to_revoke.length;
      continue;
    }

    revoked += revokedCount ?? 0;

    // Insert replacement passes in the correct lot.
    const toInsert = issue.passes_to_revoke.map(() => ({
      family_id: issue.family_id,
      lot_id: targetLot.id,
      assigned_by: assignedBy,
    }));

    const { error: insertErr } = await supabase.from("parking_passes").insert(toInsert);
    if (insertErr) {
      skipped += issue.passes_to_revoke.length;
      continue;
    }

    assigned += issue.passes_to_revoke.length;
    // Update running count so subsequent issues use the updated capacity.
    targetLot.assigned += issue.passes_to_revoke.length;
  }

  return NextResponse.json({ ok: true, revoked, assigned, skipped, fallbacks_used });
}
