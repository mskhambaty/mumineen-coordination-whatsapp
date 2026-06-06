import { NextRequest, NextResponse } from "next/server";

import { canManageParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/parking/passes/bulk — assign one pass per household to a single lot.
// Households already holding a pass in that lot are skipped so re-running a bulk assign
// never doubles anyone (deliberate extras go through the single-assign endpoint).
// Capacity is deliberately NOT enforced (soft-warn in the UI only).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    lot_id?: unknown;
    family_ids?: unknown;
  };
  const lotId = typeof body.lot_id === "string" ? body.lot_id : "";
  const familyIds =
    Array.isArray(body.family_ids) && body.family_ids.every((id) => typeof id === "string")
      ? (body.family_ids as string[])
      : null;
  if (!lotId || !familyIds || familyIds.length === 0) {
    return NextResponse.json({ error: "Missing lot_id or family_ids." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Existing passes for this lot are bounded by lot capacity (hundreds at most) —
  // fetch them all rather than .in() over potentially thousands of selected ids.
  const { data: existing, error: existingError } = await supabase
    .from("parking_passes")
    .select("family_id")
    .eq("lot_id", lotId);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  const already = new Set((existing ?? []).map((p) => p.family_id));

  const unique = [...new Set(familyIds)];
  const toInsert = unique.filter((id) => !already.has(id));

  if (toInsert.length > 0) {
    const { error } = await supabase.from("parking_passes").insert(
      toInsert.map((familyId) => ({
        family_id: familyId,
        lot_id: lotId,
        assigned_by: auth.caller.user_id,
      })),
    );
    if (error) {
      // FK violations (bad family/lot id) surface as 400s; anything else is a 500.
      const status = error.code === "23503" ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
  }

  return NextResponse.json({ ok: true, assigned: toInsert.length, skipped: unique.length - toInsert.length });
}
