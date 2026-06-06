import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { resolveParkingCaller } from "@/lib/parking/auth";
import { LOT_PURPOSES } from "@/lib/parking/rollups";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const LOT_COLS = "id, name, capacity, color, purposes, sort_order";

// GET /api/admin/parking/lots — all lots with live assigned-pass counts.
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caller = await resolveParkingCaller(req);
  if (!caller.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data: lots, error } = await supabase.from("parking_lots").select(LOT_COLS).order("sort_order");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Pass volume is small (a few hundred rows) — count in one fetch rather than per-lot queries.
  const { data: passes } = await supabase.from("parking_passes").select("lot_id");
  const counts = new Map<string, number>();
  for (const p of passes ?? []) {
    counts.set(p.lot_id, (counts.get(p.lot_id) ?? 0) + 1);
  }

  return NextResponse.json({
    lots: (lots ?? []).map((l) => ({ ...l, assigned: counts.get(l.id) ?? 0 })),
    can_manage: caller.canManage,
  });
}

// PATCH /api/admin/parking/lots — edit one lot's capacity/color/purposes (no add/delete; lots are seeded).
export async function PATCH(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caller = await resolveParkingCaller(req);
  if (!caller.canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    capacity?: unknown;
    color?: unknown;
    purposes?: unknown;
  };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing lot id." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.capacity !== undefined) {
    const capacity = Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity < 0) {
      return NextResponse.json({ error: "Capacity must be a non-negative integer." }, { status: 400 });
    }
    patch.capacity = capacity;
  }
  if (body.color !== undefined) {
    patch.color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : null;
  }
  if (body.purposes !== undefined) {
    const purposes = Array.isArray(body.purposes) ? body.purposes : null;
    if (!purposes || !purposes.every((p) => (LOT_PURPOSES as readonly string[]).includes(p as string))) {
      return NextResponse.json({ error: "Invalid purposes." }, { status: 400 });
    }
    patch.purposes = purposes;
  }

  const { data: lot, error } = await getSupabaseAdmin()
    .from("parking_lots")
    .update(patch)
    .eq("id", id)
    .select(LOT_COLS)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!lot) {
    return NextResponse.json({ error: "Lot not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, lot });
}
