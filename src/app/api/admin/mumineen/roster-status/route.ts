import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canImportMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BodySchema = z.object({
  hof_its: z.string().trim().min(1),
  active: z.boolean(),
});

// Columns returned so the roster list can refresh in place after the toggle.
const MEMBER_COLS = "its, full_name, is_head, roster_active";

// POST /api/admin/mumineen/roster-status — flip a whole family's roster membership on/off.
// Body: { hof_its, active }. Activates/deactivates the family row and every member sharing that
// hof_its in one shot. This is the UI counterpart to the bulk import's soft-deactivation, so it's
// gated to the same tier (canImportMumineen: admin/leadership + IT). Restricted because it alters
// who is on the roster at all — heavier than a routine per-member correction.
//
// NOTE: roster_active is the ONLY membership state to maintain here. The current schema has no
// family head-linkage columns; the sole "head" flag is mumineen.is_head = (its == hof_its), which
// is independent of roster_active and so is untouched by an activate/deactivate.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canImportMumineen);
  if (auth instanceof NextResponse) return auth;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "hof_its and active (boolean) are required." }, { status: 400 });
  }
  const { hof_its: hofIts, active } = parsed.data;

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // The family must exist — regardless of its current roster_active state (the whole point is to
  // act on deactivated families, which the normal active-scoped reads can't see).
  const { data: family, error: lookupErr } = await supabase
    .from("families")
    .select("id, hof_its")
    .eq("hof_its", hofIts)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!family) {
    return NextResponse.json({ error: "Family not found." }, { status: 404 });
  }

  // Flip the family row, then every member. The .neq() keeps it safe-update friendly and skips
  // rows already at the target value (so updated_at isn't bumped needlessly).
  const { error: famErr } = await supabase
    .from("families")
    .update({ roster_active: active, updated_at: nowIso })
    .eq("hof_its", hofIts)
    .neq("roster_active", active);
  if (famErr) {
    return NextResponse.json({ error: famErr.message }, { status: 500 });
  }

  const { error: memErr } = await supabase
    .from("mumineen")
    .update({ roster_active: active, updated_at: nowIso })
    .eq("hof_its", hofIts)
    .neq("roster_active", active);
  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  // Re-read the members so the client can refresh without another round-trip.
  const { data: members } = await supabase
    .from("mumineen")
    .select(MEMBER_COLS)
    .eq("hof_its", hofIts)
    .order("is_head", { ascending: false })
    .order("age", { ascending: false });

  return NextResponse.json({ ok: true, hof_its: hofIts, active, members: members ?? [] });
}
