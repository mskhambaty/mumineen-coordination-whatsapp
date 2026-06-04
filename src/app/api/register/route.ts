import { NextRequest, NextResponse } from "next/server";

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
  let hofIts: string | null = null;
  const { data: member } = await supabase
    .from("mumineen")
    .select("hof_its")
    .eq("its", input)
    .eq("roster_active", true)
    .maybeSingle();
  if (member?.hof_its) {
    hofIts = member.hof_its;
  } else {
    const { data: directFamily } = await supabase
      .from("families")
      .select("hof_its")
      .eq("hof_its", input)
      .eq("roster_active", true)
      .maybeSingle();
    hofIts = directFamily?.hof_its ?? null;
  }
  if (!hofIts) {
    return NextResponse.json({ error: "We couldn't find a family for that ITS number." }, { status: 404 });
  }

  const { data: family } = await supabase
    .from("families")
    .select("hof_its, registration_status, acc_type, hotel_name, hotel_address, hotel_lat, hotel_lon, open_to_utaro, utaro_host_name, utaro_host_its, utaro_host_address, utaro_host_whatsapp_e164, utaro_host_email, transport_mode, transport_detail")
    .eq("hof_its", hofIts)
    .eq("roster_active", true)
    .maybeSingle();

  if (!family) {
    return NextResponse.json({ error: "We couldn't find a family with that HOF ITS number." }, { status: 404 });
  }

  // One-time submission: once submitted/confirmed the form is locked; changes go via the helpline.
  if (family.registration_status === "submitted" || family.registration_status === "confirmed") {
    return NextResponse.json({ locked: true, status: family.registration_status });
  }

  const { data: members } = await supabase
    .from("mumineen")
    .select("its, full_name, gender, age, is_adult, is_head, whatsapp_e164, email, arrival_at, arrival_flight_no, departure_at, departure_flight_no, rahat_seating, wheelchair, special_needs")
    .eq("hof_its", hofIts)
    .eq("roster_active", true)
    .order("is_head", { ascending: false })
    .order("age", { ascending: false });

  return NextResponse.json({ family, members: members ?? [] });
}

type MemberInput = {
  its?: unknown;
  whatsapp_e164?: unknown;
  email?: unknown;
  arrival_at?: unknown;
  arrival_flight_no?: unknown;
  departure_at?: unknown;
  departure_flight_no?: unknown;
  rahat_seating?: unknown;
  wheelchair?: unknown;
  special_needs?: unknown;
};

type RegisterBody = {
  hof_its?: unknown;
  submitted_by_its?: unknown;
  members?: unknown;
  accommodation?: Record<string, unknown>;
  transport?: Record<string, unknown>;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const bool = (v: unknown) => v === true || v === "true";
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) ? n : null;
};
const ts = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const oneOf = (v: unknown, allowed: string[]) => {
  const s = str(v);
  return s && allowed.includes(s) ? s : null;
};

// Only a WhatsApp number + valid email are required (the head provides them in the form).
// Everything else is optional and editable later. Mirrors the form. Returns first problem or null.
function validateSubmission(members: MemberInput[]): string | null {
  const present = members.filter((m) => str(m.its));
  if (present.length === 0) return "No family members were submitted.";
  const hasContact = present.some((m) => {
    const email = str(m.email);
    return Boolean(str(m.whatsapp_e164)) && Boolean(email) && /^\S+@\S+\.\S+$/.test(email as string);
  });
  if (!hasContact) return "A WhatsApp number and a valid email are required.";
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

  // Require at least a contact (WhatsApp + email); the rest is optional and editable later.
  const incomplete = validateSubmission(members);
  if (incomplete) {
    return NextResponse.json({ error: incomplete }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: family } = await supabase.from("families").select("id, registration_status").eq("hof_its", hofIts).eq("roster_active", true).maybeSingle();
  if (!family) {
    return NextResponse.json({ error: "Family not found." }, { status: 404 });
  }
  // One-time submission — reject a second submit (e.g. a form left open before another member submitted).
  if (family.registration_status === "submitted" || family.registration_status === "confirmed") {
    return NextResponse.json({ error: "This registration has already been submitted. Please contact the helpline to make changes.", locked: true }, { status: 409 });
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
  const { error: famError } = await supabase
    .from("families")
    .update({
      acc_type: oneOf(acc.acc_type, ["hotel", "utaro"]),
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
      transport_mode: oneOf(tr.transport_mode, ["rideshare", "rental", "commute_with_utaro", "other"]),
      transport_detail: str(tr.transport_detail),
      registration_status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by_its: str(body.submitted_by_its),
      updated_at: new Date().toISOString(),
    })
    .eq("hof_its", hofIts);

  if (famError) {
    return NextResponse.json({ error: famError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, members_updated: ids.length });
}
