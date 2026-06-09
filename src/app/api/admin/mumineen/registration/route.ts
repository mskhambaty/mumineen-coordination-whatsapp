import { NextRequest, NextResponse } from "next/server";

import { canAccessMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/mumineen/registration — committee cancel/reopen of a family's registration.
// Soft delete: cancelling preserves all family + member data and just flips the status so the
// record drops out of "registered" counts and the form unlocks for a fresh submission on reopen.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { hof_its?: unknown; action?: unknown; reason?: unknown };
  const hofIts = typeof body.hof_its === "string" ? body.hof_its.trim() : "";
  const action =
    body.action === "reopen"
      ? "reopen"
      : body.action === "cancel"
        ? "cancel"
        : body.action === "not_attending"
          ? "not_attending"
          : null;
  if (!hofIts || !action) {
    return NextResponse.json({ error: "hof_its and a valid action (cancel|reopen|not_attending) are required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // "Family not attending": register the family (so they drop out of the unregistered nudge and
  // count as having responded) and flag every roster member not_attending. All operational rollups
  // already exclude not_attending members; we also reseed Niyaz RSVP to attending=false.
  if (action === "not_attending") {
    const { data: family } = await supabase
      .from("families")
      .select("id, registration_status")
      .eq("hof_its", hofIts)
      .eq("roster_active", true)
      .maybeSingle();
    if (!family) {
      return NextResponse.json({ error: "Family not found." }, { status: 404 });
    }
    if (family.registration_status === "submitted" || family.registration_status === "confirmed") {
      return NextResponse.json({ error: "This family is already registered. Cancel it first to change their status." }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const { error: memberError } = await supabase
      .from("mumineen")
      .update({ not_attending: true, updated_at: nowIso })
      .eq("hof_its", hofIts)
      .eq("roster_active", true);
    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const { error: famError } = await supabase
      .from("families")
      .update({
        registration_status: "submitted",
        submitted_at: nowIso,
        cancelled_at: null,
        cancelled_reason: null,
        updated_at: nowIso,
      })
      .eq("hof_its", hofIts)
      .eq("roster_active", true);
    if (famError) {
      return NextResponse.json({ error: famError.message }, { status: 500 });
    }

    // Reseed per-mumin Niyaz RSVP from the now not_attending members (→ attending=false), mirroring
    // the registration submit. Best-effort: a failure here must not fail the request.
    const { error: rsvpError } = await supabase.rpc("seed_family_niyaz_rsvp", { p_family_id: family.id });
    if (rsvpError) {
      console.error("seed_family_niyaz_rsvp failed for family", family.id, rsvpError.message);
    }

    return NextResponse.json({ ok: true, hof_its: hofIts, status: "submitted" });
  }
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
