import { NextRequest, NextResponse } from "next/server";

import { canManageParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/parking/passes — assign one pass to a household. Capacity is
// deliberately NOT enforced here (soft-warn in the UI only; the team may oversell a lot).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    family_id?: unknown;
    lot_id?: unknown;
    notes?: unknown;
  };
  const familyId = typeof body.family_id === "string" ? body.family_id : "";
  const lotId = typeof body.lot_id === "string" ? body.lot_id : "";
  if (!familyId || !lotId) {
    return NextResponse.json({ error: "Missing family_id or lot_id." }, { status: 400 });
  }

  const { data: pass, error } = await getSupabaseAdmin()
    .from("parking_passes")
    .insert({
      family_id: familyId,
      lot_id: lotId,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
      assigned_by: auth.caller.user_id,
    })
    .select("id, family_id, lot_id, notes, created_at")
    .single();
  if (error) {
    // FK violations (bad family/lot id) surface as 400s; anything else is a 500.
    const status = error.code === "23503" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ok: true, pass });
}

// DELETE /api/admin/parking/passes?id=<pass-id> — revoke (hard delete, idempotent).
export async function DELETE(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing pass id." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin().from("parking_passes").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Already-deleted ids fall through to ok — revoke is idempotent by design.
  return NextResponse.json({ ok: true });
}
