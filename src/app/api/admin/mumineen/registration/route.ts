import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/mumineen/registration — committee cancel/reopen of a family's registration.
// Soft delete: cancelling preserves all family + member data and just flips the status so the
// record drops out of "registered" counts and the form unlocks for a fresh submission on reopen.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { hof_its?: unknown; action?: unknown; reason?: unknown };
  const hofIts = typeof body.hof_its === "string" ? body.hof_its.trim() : "";
  const action = body.action === "reopen" ? "reopen" : body.action === "cancel" ? "cancel" : null;
  if (!hofIts || !action) {
    return NextResponse.json({ error: "hof_its and a valid action (cancel|reopen) are required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const patch =
    action === "cancel"
      ? {
          registration_status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null,
          updated_at: new Date().toISOString(),
        }
      : {
          registration_status: "not_started",
          cancelled_at: null,
          cancelled_reason: null,
          updated_at: new Date().toISOString(),
        };

  const { error } = await supabase.from("families").update(patch).eq("hof_its", hofIts).eq("roster_active", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, hof_its: hofIts, status: patch.registration_status });
}
