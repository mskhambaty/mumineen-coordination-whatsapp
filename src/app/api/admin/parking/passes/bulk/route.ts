import { NextRequest, NextResponse } from "next/server";

import { canManageParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/parking/passes/bulk — assign passes to households up to their quota.
// Optional `quotas` map (family_id → suggested_passes) controls how many passes each
// family can receive. Without quotas, defaults to 1 per family (old behaviour).
// Families already at or above their quota are skipped. Capacity is NOT enforced (soft-warn in UI).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    lot_id?: unknown;
    family_ids?: unknown;
    quotas?: unknown;
  };
  const lotId = typeof body.lot_id === "string" ? body.lot_id : "";
  const familyIds =
    Array.isArray(body.family_ids) && body.family_ids.every((id) => typeof id === "string")
      ? (body.family_ids as string[])
      : null;
  if (!lotId || !familyIds || familyIds.length === 0) {
    return NextResponse.json({ error: "Missing lot_id or family_ids." }, { status: 400 });
  }
  const quotas: Record<string, number> | null =
    body.quotas !== null &&
    typeof body.quotas === "object" &&
    !Array.isArray(body.quotas) &&
    Object.values(body.quotas as object).every((v) => typeof v === "number")
      ? (body.quotas as Record<string, number>)
      : null;

  const supabase = getSupabaseAdmin();

  // Fetch existing passes for this lot — bounded by lot capacity, not by selection size.
  const { data: existing, error: existingError } = await supabase
    .from("parking_passes")
    .select("family_id")
    .eq("lot_id", lotId);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  // Count how many passes each family already holds for this lot.
  const existingCount = new Map<string, number>();
  for (const p of existing ?? []) {
    existingCount.set(p.family_id, (existingCount.get(p.family_id) ?? 0) + 1);
  }

  const assignedBy = auth.caller.user_id === "admin-api" ? null : auth.caller.user_id;
  const unique = [...new Set(familyIds)];
  const toInsert: { family_id: string; lot_id: string; assigned_by: string | null }[] = [];
  let skipped = 0;

  for (const id of unique) {
    const have = existingCount.get(id) ?? 0;
    const quota = quotas ? (quotas[id] ?? 1) : 1;
    const needed = quota - have;
    if (needed <= 0) { skipped++; continue; }
    for (let i = 0; i < needed; i++) {
      toInsert.push({ family_id: id, lot_id: lotId, assigned_by: assignedBy });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("parking_passes").insert(toInsert);
    if (error) {
      const status = error.code === "23503" ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
  }

  return NextResponse.json({ ok: true, assigned: toInsert.length, skipped });
}

// DELETE /api/admin/parking/passes/bulk — remove ALL passes for the given families.
// Accepts { family_ids: string[] }. Used by the bulk-unassign action on the parking page.
export async function DELETE(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { family_ids?: unknown };
  const familyIds =
    Array.isArray(body.family_ids) && body.family_ids.every((id) => typeof id === "string")
      ? (body.family_ids as string[])
      : null;
  if (!familyIds || familyIds.length === 0) {
    return NextResponse.json({ error: "Missing family_ids." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from("parking_passes")
    .delete({ count: "exact" })
    .in("family_id", familyIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
