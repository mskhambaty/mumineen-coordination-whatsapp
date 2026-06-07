import { getSupabaseAdmin } from "@/lib/supabase/server";

// --- Types ---

export type GuestRow = {
  family_id: string;
  hof_its: string;
  head_name: string | null;
  member_count: number;
  attending_count: number;
  adult_count: number;
  child_count: number;
  male_count: number;
  female_count: number;
  ages: string; // comma-separated
  has_wheelchair: boolean;
  has_special_needs: boolean;
  submitted_at: string | null;
  hotel_name: string | null;
  hotel_lat: number | null;
  hotel_lon: number | null;
  current_match_status: string | null;
};

export type HostRow = {
  id: string;
  hof_its: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  address: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  capacity_mehman: number;
  capacity_family_friends: number;
  include_family_friends: boolean;
  effective_capacity: number;
  confirmed_allocated: number;
  pending_allocated: number;
  remaining_capacity: number;
  gender_preference: string | null;
  pet_type: string | null;
  sahebo_preference: string | null;
  days_after_ashura: number | null;
  // Roster demographics (when host ITS maps to roster)
  host_family_size: number | null;
  host_ages: string | null;
  host_male_count: number | null;
  host_female_count: number | null;
  distance_to_masjid_km: number | null;
};

// Masjid location: 10S252 Kingery Hwy, Willowbrook, IL 60527
const MASJID_LAT = 41.7398;
const MASJID_LON = -87.9387;

// --- Helpers ---

/** Haversine distance in km. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data } = await buildQuery(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// --- Guest Rollups ---

type FamilyDbRow = {
  id: string;
  hof_its: string;
  registration_status: string | null;
  acc_type: string | null;
  open_to_utaro: boolean | null;
  submitted_at: string | null;
  hotel_name: string | null;
  hotel_lat: number | null;
  hotel_lon: number | null;
};

type MuminDbRow = {
  hof_its: string;
  full_name: string | null;
  gender: string | null;
  age: number | null;
  is_head: boolean;
  wheelchair: boolean;
  special_needs: string | null;
  not_attending: boolean | null;
};

/**
 * Build guest rollup rows: registered hotel families that are open_to_utaro.
 * Each row includes demographics aggregated from their mumineen.
 */
export async function buildGuestRollups(): Promise<GuestRow[]> {
  const supabase = getSupabaseAdmin();

  // Fetch families: registered + hotel + open_to_utaro
  const families = await fetchAll<FamilyDbRow>((from, to) =>
    supabase
      .from("families")
      .select("id, hof_its, registration_status, acc_type, open_to_utaro, submitted_at, hotel_name, hotel_lat, hotel_lon")
      .eq("roster_active", true)
      .in("registration_status", ["submitted", "confirmed"])
      .eq("acc_type", "hotel")
      .eq("open_to_utaro", true)
      .range(from, to),
  );

  if (families.length === 0) return [];

  // Fetch mumineen for these families
  const hofItsList = families.map((f) => f.hof_its);
  const allMembers = await fetchAll<MuminDbRow>((from, to) =>
    supabase
      .from("mumineen")
      .select("hof_its, full_name, gender, age, is_head, wheelchair, special_needs, not_attending")
      .eq("roster_active", true)
      .in("hof_its", hofItsList)
      .range(from, to),
  );

  // Fetch existing matches for these families
  const familyIds = families.map((f) => f.id);
  const matches = await fetchAll<{ guest_family_id: string; status: string }>((from, to) =>
    supabase
      .from("accommodation_matches")
      .select("guest_family_id, status")
      .in("guest_family_id", familyIds)
      .in("status", ["pending", "confirmed"])
      .range(from, to),
  );

  const matchByFamily = new Map<string, string>();
  for (const m of matches) {
    // Confirmed takes priority
    const existing = matchByFamily.get(m.guest_family_id);
    if (!existing || m.status === "confirmed") {
      matchByFamily.set(m.guest_family_id, m.status);
    }
  }

  // Group members by hof_its
  const membersByHof = new Map<string, MuminDbRow[]>();
  for (const m of allMembers) {
    const list = membersByHof.get(m.hof_its) ?? [];
    list.push(m);
    membersByHof.set(m.hof_its, list);
  }

  return families.map((f) => {
    const members = membersByHof.get(f.hof_its) ?? [];
    const attending = members.filter((m) => !m.not_attending);
    const ages = attending.map((m) => m.age).filter((a): a is number => a != null);
    const head = members.find((m) => m.is_head);
    const resolvedName = head?.full_name ?? members[0]?.full_name ?? f.hof_its;

    return {
      family_id: f.id,
      hof_its: f.hof_its,
      head_name: resolvedName,
      member_count: members.length,
      attending_count: attending.length,
      adult_count: attending.filter((m) => m.age != null && m.age >= 18).length,
      child_count: attending.filter((m) => m.age != null && m.age < 18).length,
      male_count: attending.filter((m) => m.gender === "M").length,
      female_count: attending.filter((m) => m.gender === "F").length,
      ages: ages.sort((a, b) => a - b).join(", "),
      has_wheelchair: attending.some((m) => m.wheelchair),
      has_special_needs: attending.some((m) => m.special_needs != null && m.special_needs.length > 0),
      submitted_at: f.submitted_at,
      hotel_name: f.hotel_name,
      hotel_lat: f.hotel_lat ?? null,
      hotel_lon: f.hotel_lon ?? null,
      current_match_status: matchByFamily.get(f.id) ?? null,
    };
  });
}

// --- Host Rollups ---

type HostDbRow = {
  id: string;
  hof_its: string;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  capacity_mehman: number;
  capacity_family_friends: number;
  include_family_friends: boolean;
  gender_preference: string | null;
  pet_type: string | null;
  sahebo_preference: string | null;
  days_after_ashura: number | null;
  can_provide_utaro: boolean;
};

/**
 * Build host rollup rows with remaining capacity and optional roster demographics.
 */
export async function buildHostRollups(): Promise<HostRow[]> {
  const supabase = getSupabaseAdmin();

  // Only hosts that can provide utaro and have capacity
  const hosts = await fetchAll<HostDbRow>((from, to) =>
    supabase
      .from("accommodation_hosts")
      .select("id, hof_its, first_name, last_name, address, city, lat, lon, capacity_mehman, capacity_family_friends, include_family_friends, gender_preference, pet_type, sahebo_preference, days_after_ashura, can_provide_utaro")
      .eq("can_provide_utaro", true)
      .gt("capacity_mehman", 0)
      .range(from, to),
  );

  if (hosts.length === 0) return [];

  // Get confirmed AND pending match allocations per host
  const hostIds = hosts.map((h) => h.id);
  const activeMatches = await fetchAll<{ host_id: string; guest_member_count: number; status: string }>((from, to) =>
    supabase
      .from("accommodation_matches")
      .select("host_id, guest_member_count, status")
      .in("host_id", hostIds)
      .in("status", ["confirmed", "pending"])
      .range(from, to),
  );

  const confirmedByHost = new Map<string, number>();
  const pendingByHost = new Map<string, number>();
  for (const m of activeMatches) {
    if (m.status === "confirmed") {
      confirmedByHost.set(m.host_id, (confirmedByHost.get(m.host_id) ?? 0) + m.guest_member_count);
    } else {
      pendingByHost.set(m.host_id, (pendingByHost.get(m.host_id) ?? 0) + m.guest_member_count);
    }
  }

  // Roster demographics: look up mumineen by hof_its
  const hofItsList = hosts.map((h) => h.hof_its);
  const rosterMembers = await fetchAll<{ hof_its: string; gender: string | null; age: number | null }>((from, to) =>
    supabase
      .from("mumineen")
      .select("hof_its, gender, age")
      .eq("roster_active", true)
      .in("hof_its", hofItsList)
      .range(from, to),
  );

  const rosterByHof = new Map<string, { hof_its: string; gender: string | null; age: number | null }[]>();
  for (const m of rosterMembers) {
    const list = rosterByHof.get(m.hof_its) ?? [];
    list.push(m);
    rosterByHof.set(m.hof_its, list);
  }

  return hosts.map((h) => {
    const effectiveCap = h.capacity_mehman + (h.include_family_friends ? h.capacity_family_friends : 0);
    const confirmed = confirmedByHost.get(h.id) ?? 0;
    const pending = pendingByHost.get(h.id) ?? 0;
    const remaining = Math.max(0, effectiveCap - confirmed - pending);

    const roster = rosterByHof.get(h.hof_its);
    const hostAges = roster?.map((m) => m.age).filter((a): a is number => a != null) ?? [];
    const distToMasjid = h.lat != null && h.lon != null ? haversineKm(h.lat, h.lon, MASJID_LAT, MASJID_LON) : null;

    return {
      id: h.id,
      hof_its: h.hof_its,
      first_name: h.first_name,
      last_name: h.last_name,
      display_name: [h.first_name, h.last_name].filter(Boolean).join(" ") || h.hof_its,
      address: h.address,
      city: h.city,
      lat: h.lat,
      lon: h.lon,
      capacity_mehman: h.capacity_mehman,
      capacity_family_friends: h.capacity_family_friends,
      include_family_friends: h.include_family_friends,
      effective_capacity: effectiveCap,
      confirmed_allocated: confirmed,
      pending_allocated: pending,
      remaining_capacity: remaining,
      gender_preference: h.gender_preference,
      pet_type: h.pet_type,
      sahebo_preference: h.sahebo_preference,
      days_after_ashura: h.days_after_ashura,
      host_family_size: roster?.length ?? null,
      host_ages: hostAges.length > 0 ? hostAges.sort((a, b) => a - b).join(", ") : null,
      host_male_count: roster?.filter((m) => m.gender === "M").length ?? null,
      host_female_count: roster?.filter((m) => m.gender === "F").length ?? null,
      distance_to_masjid_km: distToMasjid != null ? Math.round(distToMasjid * 10) / 10 : null,
    };
  });
}
