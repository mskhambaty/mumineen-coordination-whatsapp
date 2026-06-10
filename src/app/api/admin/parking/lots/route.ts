import { NextRequest, NextResponse } from "next/server";

import { canManageParking, canViewParking, isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { LOT_PURPOSES } from "@/lib/parking/rollups";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const LOT_COLS = "id, name, capacity, color, purposes, sort_order";

// GET /api/admin/parking/lots — all lots with live assigned-pass counts.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewParking);
  if (auth instanceof NextResponse) return auth;
  const canManage = auth.caller.portal ? canManageParking(auth.caller.portal) : false;

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
    can_manage: canManage,
  });
}

// PATCH /api/admin/parking/lots — edit one lot's name/capacity/color/purposes (no add/delete; lots are seeded).
export async function PATCH(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    name?: unknown;
    capacity?: unknown;
    color?: unknown;
    purposes?: unknown;
  };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing lot id." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Lot name cannot be empty." }, { status: 400 });
    }
    patch.name = name;
  }
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
    // parking_lots.name is unique at the DB level — surface a friendly 400 on collision.
    if (error.code === "23505") {
      return NextResponse.json({ error: "A lot with that name already exists." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!lot) {
    return NextResponse.json({ error: "Lot not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, lot });
}

// DELETE /api/admin/parking/lots?id=<lot-id> — permanently remove a lot (admin/leadership only).
// Blocked if any passes are still assigned — revoke them first.
export async function DELETE(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing lot id." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { count, error: countErr } = await supabase
    .from("parking_passes")
    .select("id", { count: "exact", head: true })
    .eq("lot_id", id);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if (count && count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} pass${count === 1 ? "" : "es"} are still assigned to this lot. Revoke them first.` },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("parking_lots").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
