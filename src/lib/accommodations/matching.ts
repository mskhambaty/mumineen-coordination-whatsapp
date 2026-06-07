import { getSupabaseAdmin } from "@/lib/supabase/server";
import { buildGuestRollups, buildHostRollups, type GuestRow, type HostRow } from "./rollups";

// --- Types ---

export type MatchSuggestion = {
  guest: GuestRow;
  host: HostRow;
  score: number;
  reasons: string[];
};

// --- Scoring ---

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

/**
 * Score a guest-host pair. Higher is better.
 * Factors: FIFO (submitted_at), proximity, demographics/mobility, gender_preference alignment.
 */
function scoreMatch(guest: GuestRow, host: HostRow, fifoRank: number, totalGuests: number): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. FIFO: earlier submitted_at gets higher score (max 40 points)
  const fifoScore = totalGuests > 1 ? 40 * (1 - fifoRank / (totalGuests - 1)) : 40;
  score += fifoScore;
  if (fifoRank < 5) reasons.push("Early registration");

  // 2. Proximity: closer host to masjid = better (max 30 points)
  if (host.distance_to_masjid_km != null) {
    // Within 5km is best; >30km gets 0
    const proxScore = Math.max(0, 30 * (1 - host.distance_to_masjid_km / 30));
    score += proxScore;
    if (host.distance_to_masjid_km <= 10) reasons.push(`Close to masjid (${host.distance_to_masjid_km}km)`);
  }

  // Also consider guest hotel proximity to host (if both geocoded)
  if (guest.hotel_lat != null && guest.hotel_lon != null && host.lat != null && host.lon != null) {
    const guestHostDist = haversineKm(guest.hotel_lat, guest.hotel_lon, host.lat, host.lon);
    if (guestHostDist <= 10) {
      score += 5;
      reasons.push("Near guest hotel");
    }
  }

  // 3. Demographics/mobility: wheelchair/special needs families get bonus for accessible hosts (max 15 points)
  if (guest.has_wheelchair || guest.has_special_needs) {
    // Bonus for hosts with larger capacity (likely more space/accessibility)
    if (host.effective_capacity >= guest.member_count * 2) {
      score += 10;
      reasons.push("Spacious for accessibility");
    }
    // Bonus if host family includes seniors (likely ground-floor living)
    if (host.host_ages && host.host_ages.split(", ").some((a) => parseInt(a) >= 65)) {
      score += 5;
      reasons.push("Senior host household");
    }
  }

  // 4. Gender preference alignment (max 15 points)
  if (host.gender_preference) {
    const pref = host.gender_preference.toLowerCase();
    if (pref.includes("mardo") && guest.male_count > guest.female_count) {
      score += 15;
      reasons.push("Gender preference match (mardo)");
    } else if (pref.includes("bairo") && guest.female_count > guest.male_count) {
      score += 15;
      reasons.push("Gender preference match (bairo)");
    } else if (pref.includes("no preference") || pref.includes("either")) {
      score += 10;
      reasons.push("Host has no gender preference");
    }
  } else {
    score += 10; // No preference = flexible
  }

  return { score: Math.round(score * 10) / 10, reasons };
}

// --- Main Matching ---

/**
 * Generate match suggestions for unmatched guests.
 * Returns a ranked list of guest-host pairs sorted by score descending.
 * Only suggests hosts with enough remaining capacity for the entire guest family.
 */
export async function suggestMatches(): Promise<MatchSuggestion[]> {
  const [guests, hosts] = await Promise.all([buildGuestRollups(), buildHostRollups()]);

  // Only unmatched guests (no pending or confirmed match)
  const unmatchedGuests = guests.filter((g) => g.current_match_status == null);

  // Sort guests by submitted_at for FIFO ranking
  const sortedGuests = [...unmatchedGuests].sort((a, b) => {
    const aTime = a.submitted_at ? new Date(a.submitted_at).getTime() : Infinity;
    const bTime = b.submitted_at ? new Date(b.submitted_at).getTime() : Infinity;
    return aTime - bTime;
  });

  // Only hosts with remaining capacity
  const availableHosts = hosts.filter((h) => h.remaining_capacity > 0);

  const suggestions: MatchSuggestion[] = [];

  for (let fifoRank = 0; fifoRank < sortedGuests.length; fifoRank++) {
    const guest = sortedGuests[fifoRank];

    // Hard constraint: host must fit entire family
    const eligibleHosts = availableHosts.filter((h) => h.remaining_capacity >= guest.member_count);

    for (const host of eligibleHosts) {
      const { score, reasons } = scoreMatch(guest, host, fifoRank, sortedGuests.length);
      suggestions.push({ guest, host, score, reasons });
    }
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.score - a.score);

  return suggestions;
}

// --- Confirm Match ---

/**
 * Confirm a pending match: update match status, deduct host capacity, update guest families row.
 */
export async function confirmMatch(matchId: string, confirmedBy: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // 1. Load the match
  const { data: match, error: matchErr } = await supabase
    .from("accommodation_matches")
    .select("id, guest_family_id, host_id, status, guest_member_count")
    .eq("id", matchId)
    .single();

  if (matchErr || !match) throw new Error("Match not found");
  if (match.status === "confirmed") throw new Error("Match is already confirmed");
  if (match.status !== "pending") throw new Error(`Cannot confirm a match with status: ${match.status}`);

  // 2. Load the host
  const { data: host, error: hostErr } = await supabase
    .from("accommodation_hosts")
    .select("hof_its, first_name, last_name, address, capacity_mehman, capacity_family_friends, include_family_friends")
    .eq("id", match.host_id)
    .single();

  if (hostErr || !host) throw new Error("Host not found");

  // 3. Check capacity (only confirmed matches count)
  const { data: existingConfirmed } = await supabase
    .from("accommodation_matches")
    .select("guest_member_count")
    .eq("host_id", match.host_id)
    .eq("status", "confirmed");

  const currentAllocated = (existingConfirmed ?? []).reduce((sum, m) => sum + (m.guest_member_count ?? 0), 0);
  const effectiveCap = host.capacity_mehman + (host.include_family_friends ? host.capacity_family_friends : 0);
  const remaining = effectiveCap - currentAllocated;

  if (remaining < match.guest_member_count) {
    throw new Error(`Insufficient host capacity: ${remaining} remaining, ${match.guest_member_count} needed`);
  }

  // 4. Load current guest family fields for audit
  const { data: family, error: famErr } = await supabase
    .from("families")
    .select("acc_type, utaro_host_name, utaro_host_its, utaro_host_address")
    .eq("id", match.guest_family_id)
    .single();

  if (famErr || !family) throw new Error("Guest family not found");

  // 5. Update match to confirmed
  const { error: updateMatchErr } = await supabase
    .from("accommodation_matches")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: confirmedBy,
      previous_acc_type: family.acc_type,
      previous_utaro_host_name: family.utaro_host_name,
      previous_utaro_host_its: family.utaro_host_its,
      previous_utaro_host_address: family.utaro_host_address,
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId);

  if (updateMatchErr) throw new Error(`Failed to confirm match: ${updateMatchErr.message}`);

  // 6. Update guest family record
  const hostName = [host.first_name, host.last_name].filter(Boolean).join(" ") || host.hof_its;
  const { error: updateFamErr } = await supabase
    .from("families")
    .update({
      acc_type: "utaro",
      utaro_host_name: hostName,
      utaro_host_its: host.hof_its,
      utaro_host_address: host.address,
      updated_at: new Date().toISOString(),
    })
    .eq("id", match.guest_family_id);

  if (updateFamErr) throw new Error(`Failed to update guest family: ${updateFamErr.message}`);
}

/**
 * Create a pending match (no side effects on families table).
 */
export async function createPendingMatch(
  guestFamilyId: string,
  hostId: string,
  guestMemberCount: number,
  notes?: string,
): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("accommodation_matches")
    .upsert(
      {
        guest_family_id: guestFamilyId,
        host_id: hostId,
        status: "pending",
        guest_member_count: guestMemberCount,
        notes: notes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guest_family_id,host_id" },
    )
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create match: ${error.message}`);
  return data.id as string;
}

/**
 * Reject or cancel a match. If it was confirmed, revert the guest family's utaro fields.
 */
export async function rejectMatch(matchId: string, newStatus: "rejected" | "cancelled"): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: match, error: matchErr } = await supabase
    .from("accommodation_matches")
    .select("id, guest_family_id, status, previous_acc_type, previous_utaro_host_name, previous_utaro_host_its, previous_utaro_host_address")
    .eq("id", matchId)
    .single();

  if (matchErr || !match) throw new Error("Match not found");

  // If was confirmed, revert family fields
  if (match.status === "confirmed") {
    const { error: revertErr } = await supabase
      .from("families")
      .update({
        acc_type: match.previous_acc_type ?? "hotel",
        utaro_host_name: match.previous_utaro_host_name,
        utaro_host_its: match.previous_utaro_host_its,
        utaro_host_address: match.previous_utaro_host_address,
        updated_at: new Date().toISOString(),
      })
      .eq("id", match.guest_family_id);

    if (revertErr) throw new Error(`Failed to revert family: ${revertErr.message}`);
  }

  const { error: updateErr } = await supabase
    .from("accommodation_matches")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", matchId);

  if (updateErr) throw new Error(`Failed to update match: ${updateErr.message}`);
}
