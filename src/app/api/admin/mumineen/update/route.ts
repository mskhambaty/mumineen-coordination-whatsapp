import { NextRequest, NextResponse } from "next/server";

import { canAccessMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { ACC_TYPES, AIRPORTS, TRANSPORT_MODES, bool, khidmatIds, oneOf, str, ts } from "@/lib/registration/normalize";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MemberPatch = {
  local_mehman?: unknown;
  whatsapp_e164?: unknown;
  email?: unknown;
  arrival_at?: unknown;
  arrival_flight_no?: unknown;
  departure_at?: unknown;
  departure_flight_no?: unknown;
  airport?: unknown;
  not_attending?: unknown;
  wants_khidmat?: unknown;
  khidmat_department_ids?: unknown;
  rahat_seating?: unknown;
  wheelchair?: unknown;
  special_needs?: unknown;
};

type FamilyPatch = {
  acc_type?: unknown;
  hotel_name?: unknown;
  hotel_address?: unknown;
  open_to_utaro?: unknown;
  utaro_host_name?: unknown;
  utaro_host_its?: unknown;
  utaro_host_address?: unknown;
  utaro_host_whatsapp_e164?: unknown;
  utaro_host_email?: unknown;
  transport_mode?: unknown;
  transport_detail?: unknown;
};

type UpdateBody = { its?: unknown; member?: MemberPatch; family?: FamilyPatch };

// Columns returned to the client so the modal can refresh in place after a save.
const MEMBER_COLS =
  "its, full_name, gender, age, jamaat, city, hof_its, is_head, whatsapp_e164, email, " +
  "idara, category, prefix, title, venue, local_mehman, is_adult, " +
  "arrival_at, arrival_flight_no, departure_at, departure_flight_no, airport, daily_trans, roster_arrival_raw, roster_flight_code, " +
  "rahat_seating, wheelchair, special_needs, wants_khidmat, not_attending, khidmat_department_ids, whatsapp_link_clicked, updated_at";
const FAMILY_COLS =
  "registration_status, submitted_at, submitted_by_its, acc_type, hotel_name, hotel_address, open_to_utaro, " +
  "utaro_host_name, utaro_host_its, utaro_host_address, utaro_host_whatsapp_e164, utaro_host_email, " +
  "transport_mode, transport_detail";

// POST /api/admin/mumineen/update — admin edit of one member's registered details (and, optionally,
// their family's accommodation/transport). Unlike the public /api/register POST, this is NOT gated by
// the one-time submission lock and never touches registration_status/submitted_at — it's a correction tool.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as UpdateBody;
  const its = str(body.its);
  if (!its) {
    return NextResponse.json({ error: "Missing ITS." }, { status: 400 });
  }
  const m = body.member ?? {};

  const supabase = getSupabaseAdmin();

  // Resolve the member (and its family) up front so we can scope writes and refresh phone links.
  const { data: existing } = await supabase
    .from("mumineen")
    .select("id, hof_its")
    .eq("its", its)
    .eq("roster_active", true)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const wantsKhidmat = bool(m.wants_khidmat);
  const rahat = bool(m.rahat_seating);
  const whatsapp = str(m.whatsapp_e164);

  // Only overwrite local_mehman when a valid value was provided — never null it out.
  const localMehman = oneOf(m.local_mehman, ["Local", "Mehman"]);

  const { error: memberError } = await supabase
    .from("mumineen")
    .update({
      ...(localMehman ? { local_mehman: localMehman } : {}),
      whatsapp_e164: whatsapp,
      email: str(m.email),
      arrival_at: ts(m.arrival_at),
      arrival_flight_no: str(m.arrival_flight_no),
      departure_at: ts(m.departure_at),
      departure_flight_no: str(m.departure_flight_no),
      airport: oneOf(m.airport, AIRPORTS),
      not_attending: bool(m.not_attending),
      wants_khidmat: wantsKhidmat,
      khidmat_department_ids: wantsKhidmat ? khidmatIds(m.khidmat_department_ids) : [],
      rahat_seating: rahat,
      wheelchair: rahat && bool(m.wheelchair),
      special_needs: str(m.special_needs),
      updated_at: new Date().toISOString(),
    })
    .eq("its", its)
    .eq("roster_active", true);

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  // Refresh this member's registration-sourced phone link (handles a changed/cleared number).
  await supabase.from("mumin_phone_links").delete().eq("mumin_id", existing.id).eq("source", "registration");
  if (whatsapp) {
    await supabase
      .from("mumin_phone_links")
      .upsert({ phone_e164: whatsapp, mumin_id: existing.id, source: "registration" }, { onConflict: "phone_e164,mumin_id" });
  }

  // Family-level accommodation/transport (shared across the family). Status fields are left untouched.
  if (body.family) {
    const f = body.family;
    const { error: famError } = await supabase
      .from("families")
      .update({
        acc_type: oneOf(f.acc_type, ACC_TYPES),
        hotel_name: str(f.hotel_name),
        hotel_address: str(f.hotel_address),
        open_to_utaro: bool(f.open_to_utaro),
        utaro_host_name: str(f.utaro_host_name),
        utaro_host_its: str(f.utaro_host_its),
        utaro_host_address: str(f.utaro_host_address),
        utaro_host_whatsapp_e164: str(f.utaro_host_whatsapp_e164),
        utaro_host_email: str(f.utaro_host_email),
        transport_mode: oneOf(f.transport_mode, TRANSPORT_MODES),
        transport_detail: str(f.transport_detail),
        updated_at: new Date().toISOString(),
      })
      .eq("hof_its", existing.hof_its);
    if (famError) {
      return NextResponse.json({ error: famError.message }, { status: 500 });
    }
  }

  // Re-read the updated rows so the modal can refresh without another round-trip.
  const { data: member } = await supabase
    .from("mumineen")
    .select(MEMBER_COLS)
    .eq("its", its)
    .eq("roster_active", true)
    .maybeSingle();
  const { data: family } = await supabase
    .from("families")
    .select(FAMILY_COLS)
    .eq("hof_its", existing.hof_its)
    .maybeSingle();

  return NextResponse.json({ ok: true, member, family });
}
