import { NextRequest, NextResponse } from "next/server";

import { canAccessMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Family-level registration fields cleared on unregister (everything the form collects).
const CLEARED_FAMILY_FIELDS = {
  acc_type: null,
  hotel_name: null,
  hotel_address: null,
  hotel_lat: null,
  hotel_lon: null,
  open_to_utaro: false,
  utaro_host_name: null,
  utaro_host_its: null,
  utaro_host_address: null,
  utaro_host_whatsapp_e164: null,
  utaro_host_email: null,
  transport_mode: null,
  transport_detail: null,
  submitted_at: null,
  submitted_by_its: null,
} as const;

// POST /api/admin/mumineen/registration — committee registration actions for a family.
//   action=unregister     reset a registered family back to pending (not_started), wiping all
//                          registration details, clearing every member's not_attending flag, and
//                          deleting the family's Niyaz RSVP rows. Dangerous: it discards data.
//   action=not_attending   register the family (status=submitted) and mark every member not
//                          attending, then reseed Niyaz RSVP to attending=false.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { hof_its?: unknown; action?: unknown };
  const hofIts = typeof body.hof_its === "string" ? body.hof_its.trim() : "";
  const action =
    body.action === "unregister" ? "unregister" : body.action === "not_attending" ? "not_attending" : null;
  if (!hofIts || !action) {
    return NextResponse.json({ error: "hof_its and a valid action (unregister|not_attending) are required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: family } = await supabase
    .from("families")
    .select("id, registration_status")
    .eq("hof_its", hofIts)
    .eq("roster_active", true)
    .maybeSingle();
  if (!family) {
    return NextResponse.json({ error: "Family not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  // "Unregister": reset a registered family to pending and discard their registration data.
  if (action === "unregister") {
    const { error: memberError } = await supabase
      .from("mumineen")
      .update({ not_attending: false, updated_at: nowIso })
      .eq("hof_its", hofIts)
      .eq("roster_active", true);
    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const { error: famError } = await supabase
      .from("families")
      .update({ registration_status: "not_started", ...CLEARED_FAMILY_FIELDS, updated_at: nowIso })
      .eq("hof_its", hofIts)
      .eq("roster_active", true);
    if (famError) {
      return NextResponse.json({ error: famError.message }, { status: 500 });
    }

    // Drop the family's per-mumin Niyaz RSVP — those rows are only seeded for registered families,
    // so a now-pending family must not keep stale attendance. A fresh submit reseeds them.
    const { error: rsvpError } = await supabase.from("niyaz_rsvp").delete().eq("family_id", family.id);
    if (rsvpError) {
      return NextResponse.json({ error: rsvpError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, hof_its: hofIts, status: "not_started" });
  }

  // "Family not attending": register the family (so they drop out of the unregistered nudge and
  // count as having responded) and flag every roster member not_attending. All operational rollups
  // already exclude not_attending members; we also reseed Niyaz RSVP to attending=false.
  if (family.registration_status === "submitted") {
    return NextResponse.json({ error: "This family is already registered. Unregister it first to change their status." }, { status: 409 });
  }

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
    .update({ registration_status: "submitted", submitted_at: nowIso, updated_at: nowIso })
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
