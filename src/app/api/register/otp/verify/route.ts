import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  its: z.string().min(1).max(20),
  otp: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});

const EDIT_TOKEN_EXPIRY_MINUTES = 30;

type RosterRow = {
  arrival_at: string | null;
  arrival_flight_no: string | null;
  local_mehman: string | null;
  roster_arrival_raw: string | null;
  roster_flight_code: string | null;
  [key: string]: unknown;
};

function rosterDateToIso(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const { its, otp } = parsed;
  const supabase = getSupabaseAdmin();

  // Resolve ITS to hof_its
  const { data: member } = await supabase
    .from("mumineen")
    .select("hof_its")
    .eq("its", its)
    .eq("roster_active", true)
    .maybeSingle();

  const hofIts = member?.hof_its ?? null;
  if (!hofIts) {
    return NextResponse.json({ error: "ITS number not found." }, { status: 404 });
  }

  const otpHash = createHash("sha256").update(otp).digest("hex");
  const now = new Date().toISOString();

  // Find a matching, unexpired, unused OTP for this family
  const { data: otpRecord } = await supabase
    .from("registration_otps")
    .select("id")
    .eq("hof_its", hofIts)
    .eq("otp_hash", otpHash)
    .is("verified_at", null)
    .gt("expires_at", now)
    .limit(1)
    .maybeSingle();

  if (!otpRecord) {
    return NextResponse.json(
      { error: "Invalid or expired code. Please try again or request a new code." },
      { status: 401 },
    );
  }

  // Mark OTP as verified and issue an edit token
  const editToken = randomUUID();
  const editTokenExpiresAt = new Date(Date.now() + EDIT_TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("registration_otps")
    .update({ verified_at: now, edit_token: editToken, edit_token_expires_at: editTokenExpiresAt })
    .eq("id", otpRecord.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to verify code. Please try again." }, { status: 500 });
  }

  // Load the family's current registration data (same logic as GET /api/register)
  const { data: family } = await supabase
    .from("families")
    .select(
      "hof_its, registration_status, acc_type, hotel_name, hotel_address, hotel_lat, hotel_lon, open_to_utaro, utaro_host_name, utaro_host_its, utaro_host_address, utaro_host_whatsapp_e164, utaro_host_email, transport_mode, transport_detail",
    )
    .eq("hof_its", hofIts)
    .eq("roster_active", true)
    .maybeSingle();

  if (!family) {
    return NextResponse.json({ error: "Family not found." }, { status: 404 });
  }

  const { data: members } = await supabase
    .from("mumineen")
    .select(
      "its, full_name, gender, age, is_adult, is_head, whatsapp_e164, email, arrival_at, arrival_flight_no, departure_at, departure_flight_no, airport, not_attending, rahat_seating, wheelchair, special_needs, wants_khidmat, khidmat_department_ids, local_mehman, roster_arrival_raw, roster_flight_code",
    )
    .eq("hof_its", hofIts)
    .eq("roster_active", true)
    .order("is_head", { ascending: false })
    .order("age", { ascending: false });

  const rows = (members ?? []) as RosterRow[];
  const isLocal = rows.length > 0 && rows.every((r) => r.local_mehman === "Local");
  const prefilled = rows.map((row) => {
    const { roster_arrival_raw, roster_flight_code, local_mehman, ...m } = row;
    void local_mehman;
    return {
      ...m,
      arrival_at: m.arrival_at ?? rosterDateToIso(roster_arrival_raw),
      arrival_flight_no: m.arrival_flight_no ?? roster_flight_code,
    };
  });

  const { data: departments } = await supabase.from("departments").select("id, name").order("name");

  return NextResponse.json({
    edit_token: editToken,
    family,
    members: prefilled,
    departments: departments ?? [],
    is_local: isLocal,
  });
}
