import { getSupabaseAdmin } from "@/lib/supabase/server";

// A registered sender's roster + registration profile, assembled from a phone number.
// Used in two places:
//   1. The AI agent's "## Sender Context" block (personalize replies) — `formatSenderProfileForPrompt`.
//   2. The inbox "User Profile" panel — `toPublicSenderProfile` strips PII (age + all contacts).
// `age` lives on the full profile (the agent may use it) but never reaches the admin panel.
export type SenderProfile = {
  in_roster: boolean;
  registration_status: string | null;
  member_count: number;
  member: {
    full_name: string | null;
    age: number | null;
    gender: string | null;
    jamaat: string | null;
    city: string | null;
    local_mehman: string | null;
    category: string | null;
    title: string | null;
    not_attending: boolean;
    arrival_at: string | null;
    arrival_flight_no: string | null;
    airport: string | null;
    departure_at: string | null;
    rahat_seating: boolean;
    wheelchair: boolean;
    special_needs: string | null;
    wants_khidmat: boolean | null;
  } | null;
  family: {
    acc_type: string | null;
    hotel_name: string | null;
    utaro_host_name: string | null;
    open_to_utaro: boolean | null;
    transport_mode: string | null;
    transport_detail: string | null;
  } | null;
};

// Admin-facing projection: same profile minus age and every contact identifier
// (phone/email/ITS for the member and the utaro host). Used by the inbox panel.
export type PublicSenderProfile = Omit<SenderProfile, "member"> & {
  member: Omit<NonNullable<SenderProfile["member"]>, "age"> | null;
};

type MemberRow = {
  id: string;
  family_id: string | null;
  is_head: boolean;
  full_name: string | null;
  age: number | null;
  gender: string | null;
  jamaat: string | null;
  city: string | null;
  local_mehman: string | null;
  category: string | null;
  title: string | null;
  not_attending: boolean | null;
  arrival_at: string | null;
  arrival_flight_no: string | null;
  airport: string | null;
  departure_at: string | null;
  rahat_seating: boolean | null;
  wheelchair: boolean | null;
  special_needs: string | null;
  wants_khidmat: boolean | null;
};

type FamilyRow = {
  registration_status: string | null;
  acc_type: string | null;
  hotel_name: string | null;
  utaro_host_name: string | null;
  open_to_utaro: boolean | null;
  transport_mode: string | null;
  transport_detail: string | null;
};

const MEMBER_SELECT =
  "id, family_id, is_head, full_name, age, gender, jamaat, city, local_mehman, category, title, not_attending, arrival_at, arrival_flight_no, airport, departure_at, rahat_seating, wheelchair, special_needs, wants_khidmat";

// Resolve a phone (E.164) to its roster member + family registration profile.
// A phone can link to several roster members (shared family number); we pick the
// primary link, falling back to the head of family, then the first member.
// Returns null when the phone isn't in the roster.
export async function getSenderProfile(phone: string): Promise<SenderProfile | null> {
  const supabase = getSupabaseAdmin();

  const { data: links } = await supabase
    .from("mumin_phone_links")
    .select("mumin_id, is_primary")
    .eq("phone_e164", phone);

  if (!links || links.length === 0) return null;

  const muminIds = (links as { mumin_id: string; is_primary: boolean }[]).map((l) => l.mumin_id);
  const primaryIds = new Set(
    (links as { mumin_id: string; is_primary: boolean }[]).filter((l) => l.is_primary).map((l) => l.mumin_id),
  );

  const { data: members } = await supabase
    .from("mumineen")
    .select(MEMBER_SELECT)
    .in("id", muminIds)
    .eq("roster_active", true);

  const memberRows = (members ?? []) as MemberRow[];
  if (memberRows.length === 0) return null;

  // Prefer the primary-linked member, then the head of family, then the first.
  const primary =
    memberRows.find((m) => primaryIds.has(m.id)) ??
    memberRows.find((m) => m.is_head) ??
    memberRows[0];

  let family: FamilyRow | null = null;
  let memberCount = 1;
  if (primary.family_id) {
    const [{ data: fam }, { count }] = await Promise.all([
      supabase
        .from("families")
        .select(
          "registration_status, acc_type, hotel_name, utaro_host_name, open_to_utaro, transport_mode, transport_detail",
        )
        .eq("id", primary.family_id)
        .maybeSingle(),
      supabase
        .from("mumineen")
        .select("id", { count: "exact", head: true })
        .eq("family_id", primary.family_id)
        .eq("roster_active", true),
    ]);
    family = (fam as FamilyRow | null) ?? null;
    if (typeof count === "number" && count > 0) memberCount = count;
  }

  return {
    in_roster: true,
    registration_status: family?.registration_status ?? null,
    member_count: memberCount,
    member: {
      full_name: primary.full_name,
      age: primary.age,
      gender: primary.gender,
      jamaat: primary.jamaat,
      city: primary.city,
      local_mehman: primary.local_mehman,
      category: primary.category,
      title: primary.title,
      not_attending: primary.not_attending ?? false,
      arrival_at: primary.arrival_at,
      arrival_flight_no: primary.arrival_flight_no,
      airport: primary.airport,
      departure_at: primary.departure_at,
      rahat_seating: primary.rahat_seating ?? false,
      wheelchair: primary.wheelchair ?? false,
      special_needs: primary.special_needs,
      wants_khidmat: primary.wants_khidmat,
    },
    family: family
      ? {
          acc_type: family.acc_type,
          hotel_name: family.hotel_name,
          utaro_host_name: family.utaro_host_name,
          open_to_utaro: family.open_to_utaro,
          transport_mode: family.transport_mode,
          transport_detail: family.transport_detail,
        }
      : null,
  };
}

// Strip age (and, by construction, every contact identifier — those are never on
// SenderProfile to begin with) for the admin inbox panel.
export function toPublicSenderProfile(profile: SenderProfile): PublicSenderProfile {
  const { member, ...rest } = profile;
  if (!member) return { ...rest, member: null };
  // Drop `age`; keep everything else.
  const { age: _age, ...memberWithoutAge } = member;
  void _age;
  return { ...rest, member: memberWithoutAge };
}

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  // Date-only for prompt brevity; the timestamp is timezone-aware but the day is what matters.
  return value.slice(0, 10);
}

// Build the per-user registration lines appended under "## Sender Context" for the agent.
// Pure (no I/O) and PII-minimal: name/age/logistics help the agent personalize, but no
// phone, email, or ITS. Returns "" when there's nothing useful to add.
export function formatSenderProfileForPrompt(profile: SenderProfile | null | undefined): string {
  if (!profile || !profile.in_roster) return "";

  const lines: string[] = [];
  const m = profile.member;
  const f = profile.family;

  const status = profile.registration_status ?? "not_started";
  lines.push(
    `Registration: ${status}${profile.member_count > 1 ? ` (family of ${profile.member_count})` : ""}`,
  );

  if (m) {
    const idParts = [
      m.full_name ? `Name: ${m.full_name}` : null,
      m.age != null ? `Age: ${m.age}` : null,
      m.gender ? (m.gender === "F" ? "Female" : m.gender === "M" ? "Male" : m.gender) : null,
    ].filter(Boolean);
    if (idParts.length) lines.push(idParts.join(" | "));

    const origin = [m.city, m.jamaat].filter(Boolean).join(", ");
    const originParts = [
      origin ? `From: ${origin}` : null,
      m.local_mehman ? m.local_mehman : null,
      m.not_attending ? "Not attending" : null,
    ].filter(Boolean);
    if (originParts.length) lines.push(originParts.join(" | "));
  }

  if (f) {
    if (f.acc_type === "hotel") {
      lines.push(`Accommodation: Hotel${f.hotel_name ? ` — ${f.hotel_name}` : ""}`);
    } else if (f.acc_type === "utaro") {
      lines.push(`Accommodation: Utaro / host family${f.utaro_host_name ? ` — ${f.utaro_host_name}` : ""}`);
    }
    if (f.acc_type === "hotel" && f.open_to_utaro) lines.push("Open to utaro (host family) matching");
    if (f.transport_mode) {
      lines.push(`Transport: ${[f.transport_mode, f.transport_detail].filter(Boolean).join(" — ")}`);
    }
  }

  if (m) {
    const arrival = fmtDate(m.arrival_at);
    const departure = fmtDate(m.departure_at);
    if (arrival || departure) {
      const travel = [
        arrival ? `Arrival: ${arrival}${m.arrival_flight_no ? ` (${m.arrival_flight_no})` : ""}${m.airport ? ` at ${m.airport}` : ""}` : null,
        departure ? `Departure: ${departure}` : null,
      ].filter(Boolean);
      lines.push(travel.join(" | "));
    }

    const access = [
      m.wheelchair ? "wheelchair" : null,
      m.rahat_seating ? "rahat seating" : null,
    ].filter(Boolean);
    if (access.length) lines.push(`Accessibility: ${access.join("; ")}`);
    if (m.special_needs?.trim()) lines.push(`Special needs: ${m.special_needs.trim()}`);
    if (m.wants_khidmat) lines.push("Interested in khidmat");
  }

  if (lines.length === 0) return "";
  return `\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
