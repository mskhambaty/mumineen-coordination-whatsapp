import { NextRequest, NextResponse } from "next/server";

import { ACC_TYPES, AIRPORTS, TRANSPORT_MODES, bool, khidmatIds, num, oneOf, str, ts } from "@/lib/registration/normalize";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// NOTE: access is currently open by HOF ITS (the deferred auth decision). Before go-live,
// gate this behind a per-family token link or a verification factor. The write path below
// is idempotent and unaffected by whatever auth wraps it.

// GET /api/register?hof=<its> — load a family's roster members for the form. The ITS may belong
// to ANY family member (or the HOF directly); we resolve it to the family's hof_its.
export async function GET(req: NextRequest) {
  const input = (req.nextUrl.searchParams.get("hof") ?? "").trim();
  if (!input) {
    return NextResponse.json({ error: "Enter your ITS number." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Resolve the family: match any member's ITS, else fall back to a direct HOF ITS match
  // (covers families whose head isn't in the roster).
  const { data: member } = await supabase
    .from("mumineen")
    .select("hof_its")
    .eq("its", input)
    .eq("roster_active", true)
    .maybeSingle();
  const hofIts = member?.hof_its ?? null;
  if (!hofIts) {
    return NextResponse.json({ error: "Sorry, we couldn't find your registration. Please contact the helpline on WhatsApp at +1 630 819 0250." }, { status: 404 });
  }

  const { data: family } = await supabase
    .from("families")
    .select("hof_its, registration_status, acc_type, hotel_name, hotel_address, hotel_lat, hotel_lon, open_to_utaro, utaro_host_name, utaro_host_its, utaro_host_address, utaro_host_whatsapp_e164, utaro_host_email, transport_mode, transport_detail")
    .eq("hof_its", hofIts)
    .eq("roster_active", true)
    .maybeSingle();

  if (!family) {
    return NextResponse.json({ error: "Sorry, we couldn't find your registration. Please contact the helpline on WhatsApp at +1 630 819 0250." }, { status: 404 });
  }

  // One-time submission: once submitted/confirmed the form is locked; changes go via the helpline.
  if (family.registration_status === "submitted" || family.registration_status === "confirmed") {
    return NextResponse.json({ locked: true, status: family.registration_status });
  }

  const { data: members } = await supabase
    .from("mumineen")
    .select("its, full_name, gender, age, is_adult, is_head, whatsapp_e164, email, arrival_at, arrival_flight_no, departure_at, departure_flight_no, airport, not_attending, rahat_seating, wheelchair, special_needs, wants_khidmat, khidmat_department_ids, local_mehman, roster_arrival_raw, roster_flight_code")
    .eq("hof_its", hofIts)
    .eq("roster_active", true)
    .order("is_head", { ascending: false })
    .order("age", { ascending: false });

  // Prefill travel from the roster import where the family hasn't entered it yet. Roster arrival
  // dates can be rough/placeholder; the committee can correct them later.
  type RosterRow = {
    arrival_at: string | null;
    arrival_flight_no: string | null;
    local_mehman: string | null;
    roster_arrival_raw: string | null;
    roster_flight_code: string | null;
    [key: string]: unknown;
  };
  const rows = (members ?? []) as RosterRow[];
  // Families are homogeneous (local vs mehman) — locals skip travel/accommodation on the form.
  const isLocal = rows.length > 0 && rows.every((r) => r.local_mehman === "Local");
  const prefilled = rows.map((row) => {
    const { roster_arrival_raw, roster_flight_code, local_mehman, ...m } = row;
    void local_mehman; // used only to derive isLocal, not exposed per member
    return {
      ...m,
      arrival_at: m.arrival_at ?? rosterDateToIso(roster_arrival_raw),
      arrival_flight_no: m.arrival_flight_no ?? roster_flight_code,
    };
  });

  // Khidmat department options (public list for the optional sign-up multiselect; mehman only).
  const { data: departments } = await supabase.from("departments").select("id, name").order("name");

  return NextResponse.json({ family, members: prefilled, departments: departments ?? [], is_local: isLocal });
}

// Best-effort parse of the roster's free-text arrival (e.g. "10-Jun-25", "01-Jun-26 03:00:27").
function rosterDateToIso(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type MemberInput = {
  its?: unknown;
  whatsapp_e164?: unknown;
  email?: unknown;
  arrival_at?: unknown;
  arrival_flight_no?: unknown;
  departure_at?: unknown;
  departure_flight_no?: unknown;
  airport?: unknown;
  not_attending?: unknown;
  rahat_seating?: unknown;
  wheelchair?: unknown;
  special_needs?: unknown;
  wants_khidmat?: unknown;
  khidmat_department_ids?: unknown;
};

type RegisterBody = {
  hof_its?: unknown;
  submitted_by_its?: unknown;
  members?: unknown;
  accommodation?: Record<string, unknown>;
  transport?: Record<string, unknown>;
  edit_token?: unknown;
};

// One-time submission: everything is required except flight numbers and the rahat/same-flight
// checkboxes. Mirrors the form. Returns the first problem, or null.
function validateSubmission(members: MemberInput[], acc: Record<string, unknown>, tr: Record<string, unknown>, isLocal: boolean): string | null {
  const present = members.filter((m) => str(m.its));
  if (present.length === 0) return "No family members were submitted.";
  for (const m of present) {
    if (bool(m.not_attending)) continue; // not attending → their details aren't required
    const who = str(m.its) ?? "a member";
    if (!isLocal && typeof m.wants_khidmat !== "boolean") return `Khidmat interest is required for ${who}.`;
    if (!str(m.whatsapp_e164)) return `Missing WhatsApp number for ${who}.`;
    const email = str(m.email);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return `Missing or invalid email for ${who}.`;
    if (!isLocal) {
      if (!ts(m.arrival_at)) return `Missing arrival date & time for ${who}.`;
      if (!ts(m.departure_at)) return `Missing departure date & time for ${who}.`;
    }
  }
  // Travel, accommodation, and transport are mehman-only; locals provide none of them.
  if (!isLocal) {
    const accType = oneOf(acc.acc_type, ACC_TYPES);
    if (!accType) return "Accommodation type is required.";
    if (accType === "hotel" && (!str(acc.hotel_name) || !str(acc.hotel_address))) return "Hotel name and address are required.";
    if (accType === "utaro" && !str(acc.utaro_host_name)) return "Host name is required.";

    const mode = oneOf(tr.transport_mode, TRANSPORT_MODES);
    if (!mode) return "Transport mode is required.";
    if (mode === "other" && !str(tr.transport_detail)) return "Transport details are required.";
  }
  return null;
}

// POST /api/register — idempotent submit. Updates roster members' collected columns and the
// family's accommodation/transport, refreshes phone links, and marks the family submitted.
// Re-submission by another family member merges into the same rows (keyed by ITS / HOF ITS).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as RegisterBody;
  const hofIts = str(body.hof_its);
  if (!hofIts) {
    return NextResponse.json({ error: "Missing HOF ITS." }, { status: 400 });
  }
  const members = Array.isArray(body.members) ? (body.members as MemberInput[]) : [];
  const editToken = typeof body.edit_token === "string" ? body.edit_token.trim() : null;

  const supabase = getSupabaseAdmin();
  const { data: family } = await supabase.from("families").select("id, registration_status").eq("hof_its", hofIts).eq("roster_active", true).maybeSingle();
  if (!family) {
    return NextResponse.json({ error: "Family not found." }, { status: 404 });
  }

  let isEdit = false;
  let otpRecordId: string | null = null;

  if (family.registration_status === "submitted" || family.registration_status === "confirmed") {
    if (!editToken) {
      return NextResponse.json({ error: "This registration has already been submitted. Please contact the helpline to make changes.", locked: true }, { status: 409 });
    }
    // Validate the edit token: must be verified, unused, and not expired
    const now = new Date().toISOString();
    const { data: otpRecord } = await supabase
      .from("registration_otps")
      .select("id")
      .eq("edit_token", editToken)
      .eq("hof_its", hofIts)
      .is("edit_used_at", null)
      .not("verified_at", "is", null)
      .gt("edit_token_expires_at", now)
      .limit(1)
      .maybeSingle();
    if (!otpRecord) {
      return NextResponse.json({ error: "Edit session has expired. Please request a new code.", locked: true }, { status: 409 });
    }
    isEdit = true;
    otpRecordId = otpRecord.id;
  }

  // Local families skip travel/accommodation/in-app khidmat on the form, so validation differs.
  const { data: anyMember } = await supabase.from("mumineen").select("local_mehman").eq("hof_its", hofIts).eq("roster_active", true).limit(1).maybeSingle();
  const isLocal = anyMember?.local_mehman === "Local";

  const incomplete = validateSubmission(members, body.accommodation ?? {}, body.transport ?? {}, isLocal);
  if (incomplete) {
    return NextResponse.json({ error: incomplete }, { status: 400 });
  }

  // Update each member's collected columns — scoped to this family so a submission can't
  // write to arbitrary mumineen. Only roster members (matched by ITS) are updated.
  const updatedLinks: { mumin_id: string; phone: string }[] = [];
  for (const m of members) {
    const its = str(m.its);
    if (!its) continue;
    const { data: updated } = await supabase
      .from("mumineen")
      .update({
        whatsapp_e164: str(m.whatsapp_e164),
        email: str(m.email),
        arrival_at: ts(m.arrival_at),
        arrival_flight_no: str(m.arrival_flight_no),
        departure_at: ts(m.departure_at),
        departure_flight_no: str(m.departure_flight_no),
        airport: oneOf(m.airport, AIRPORTS),
        not_attending: bool(m.not_attending),
        wants_khidmat: bool(m.wants_khidmat),
        khidmat_department_ids: bool(m.wants_khidmat) ? khidmatIds(m.khidmat_department_ids) : [],
        rahat_seating: bool(m.rahat_seating),
        wheelchair: bool(m.rahat_seating) && bool(m.wheelchair),
        special_needs: str(m.special_needs),
        updated_at: new Date().toISOString(),
      })
      .eq("its", its)
      .eq("hof_its", hofIts)
      .select("id, whatsapp_e164")
      .maybeSingle();
    if (updated?.whatsapp_e164) updatedLinks.push({ mumin_id: updated.id, phone: updated.whatsapp_e164 });
  }

  // Refresh registration-sourced phone links for these members (handles changed numbers).
  const ids = updatedLinks.map((l) => l.mumin_id);
  if (ids.length > 0) {
    await supabase.from("mumin_phone_links").delete().in("mumin_id", ids).eq("source", "registration");
    await supabase
      .from("mumin_phone_links")
      .upsert(updatedLinks.map((l) => ({ phone_e164: l.phone, mumin_id: l.mumin_id, source: "registration" })), {
        onConflict: "phone_e164,mumin_id",
      });
  }

  // Family-level accommodation + transport + status (idempotent update).
  const acc = body.accommodation ?? {};
  const tr = body.transport ?? {};
  const nowIso = new Date().toISOString();
  const familyUpdate: Record<string, unknown> = {
    acc_type: oneOf(acc.acc_type, ACC_TYPES),
    hotel_name: str(acc.hotel_name),
    hotel_address: str(acc.hotel_address),
    hotel_lat: num(acc.hotel_lat),
    hotel_lon: num(acc.hotel_lon),
    open_to_utaro: bool(acc.open_to_utaro),
    utaro_host_name: str(acc.utaro_host_name),
    utaro_host_its: str(acc.utaro_host_its),
    utaro_host_address: str(acc.utaro_host_address),
    utaro_host_whatsapp_e164: str(acc.utaro_host_whatsapp_e164),
    utaro_host_email: str(acc.utaro_host_email),
    transport_mode: oneOf(tr.transport_mode, TRANSPORT_MODES),
    transport_detail: str(tr.transport_detail),
    updated_at: nowIso,
  };
  if (!isEdit) {
    familyUpdate.registration_status = "submitted";
    familyUpdate.submitted_at = nowIso;
    familyUpdate.submitted_by_its = str(body.submitted_by_its);
  }

  const { data: famRow, error: famError } = await supabase
    .from("families")
    .update(familyUpdate)
    .eq("hof_its", hofIts)
    .select("id")
    .maybeSingle();

  if (famError) {
    return NextResponse.json({ error: famError.message }, { status: 500 });
  }

  // (Re)default this family's per-mumin Niyaz RSVP from their (just-updated) arrival dates. Only
  // recomputes default/registration rows — any WhatsApp/admin override is preserved. Best-effort: a
  // failure here must not fail the registration submit.
  if (famRow?.id) {
    const { error: rsvpError } = await supabase.rpc("seed_family_niyaz_rsvp", { p_family_id: famRow.id });
    if (rsvpError) console.error("seed_family_niyaz_rsvp failed for family", famRow.id, rsvpError.message);
  }

  // Consume the edit token so it can't be reused
  if (isEdit && otpRecordId) {
    await supabase.from("registration_otps").update({ edit_used_at: nowIso }).eq("id", otpRecordId);
  }

  return NextResponse.json({ ok: true, members_updated: ids.length, edited: isEdit });
}
