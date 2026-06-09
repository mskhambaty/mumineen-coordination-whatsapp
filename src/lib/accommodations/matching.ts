import { getSupabaseAdmin } from "@/lib/supabase/server";
import { buildGuestRollups, buildHostRollups, type GuestRow, type HostRow } from "./rollups";

// --- Types ---

export type MatchSuggestion = {
  guest: GuestRow;
  host: HostRow;
  score: number;
  reasons: string[];
};

// --- Scoring Options ---

export type ScoringOptions = {
  fifo?: boolean;
  proximity?: boolean;
  demographics?: boolean;
};

const DEFAULT_SCORING: ScoringOptions = { fifo: true, proximity: true, demographics: true };

/**
 * Score a guest-host pair. Higher is better.
 * Factors (toggleable): FIFO (40), proximity to masjid (30), demographics/mobility (15).
 * Always-on: gender preference alignment (15).
 */
export function scoreMatch(
  guest: GuestRow,
  host: HostRow,
  fifoRank: number,
  totalGuests: number,
  opts: ScoringOptions = DEFAULT_SCORING,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. FIFO: earlier submitted_at gets higher score (max 40 points)
  if (opts.fifo !== false) {
    const fifoScore = totalGuests > 1 ? 40 * (1 - fifoRank / (totalGuests - 1)) : 40;
    score += fifoScore;
    if (fifoRank < 5) reasons.push("Early registration");
  }

  // 2. Proximity: closer host to masjid = better (max 30 points)
  if (opts.proximity !== false && host.distance_to_masjid_km != null) {
    const proxScore = Math.max(0, 30 * (1 - host.distance_to_masjid_km / 30));
    score += proxScore;
    if (host.distance_to_masjid_km <= 10) reasons.push(`Close to masjid (${host.distance_to_masjid_km}km)`);
  }

  // 3. Demographics/mobility: wheelchair/special needs families get bonus for accessible hosts (max 15 points)
  if (opts.demographics !== false && (guest.has_wheelchair || guest.has_special_needs)) {
    if (host.effective_capacity >= guest.attending_count * 2) {
      score += 10;
      reasons.push("Spacious for accessibility");
    }
    if (host.host_ages && host.host_ages.split(", ").some((a) => parseInt(a) >= 65)) {
      score += 5;
      reasons.push("Senior host household");
    }
  }

  // 4. Gender preference alignment (always on, max 15 points)
  if (host.gender_preference) {
    const pref = host.gender_preference.toLowerCase();
    if (pref.includes("mardo")) {
      if (guest.male_count > guest.female_count) {
        score += 15;
        reasons.push("Gender preference match (mardo)");
      }
    } else if (pref.includes("bairo")) {
      if (guest.female_count > guest.male_count) {
        score += 15;
        reasons.push("Gender preference match (bairo)");
      }
    } else {
      // "No", "No preference", "Either", "Either / Both", or anything else = flexible
      score += 10;
      reasons.push("Host has no gender preference");
    }
  } else {
    score += 10; // No preference = flexible
  }

  return { score: Math.round(score * 10) / 10, reasons };
}

/**
 * Hard gender filter: if host has a strict preference, exclude incompatible guests.
 * "bairo" hosts cannot be assigned guests with any males.
 * "mardo" hosts cannot be assigned guests with any females.
 */
function isGenderCompatible(guest: GuestRow, host: HostRow): boolean {
  if (!host.gender_preference) return true;
  const pref = host.gender_preference.toLowerCase();
  if (pref.includes("bairo") && guest.male_count > 0) return false;
  if (pref.includes("mardo") && guest.female_count > 0) return false;
  return true;
}

// --- Main Matching ---

/**
 * Generate match suggestions for unmatched guests.
 * Returns a ranked list of guest-host pairs sorted by score descending.
 * Only suggests hosts with enough remaining capacity for the entire guest family.
 */
export async function suggestMatches(opts?: ScoringOptions): Promise<MatchSuggestion[]> {
  const [guests, hosts] = await Promise.all([buildGuestRollups(), buildHostRollups()]);

  // Only unmatched guests with attending members
  const unmatchedGuests = guests.filter((g) => g.current_match_status == null && g.attending_count > 0);

  // Sort guests by submitted_at for FIFO ranking
  const sortedGuests = [...unmatchedGuests].sort((a, b) => {
    const aTime = a.submitted_at ? new Date(a.submitted_at).getTime() : Infinity;
    const bTime = b.submitted_at ? new Date(b.submitted_at).getTime() : Infinity;
    return aTime - bTime;
  });

  // Only hosts with remaining capacity that are enabled for suggestions
  const availableHosts = hosts.filter((h) => h.remaining_capacity > 0 && h.enabled_for_suggestions);

  const suggestions: MatchSuggestion[] = [];

  for (let fifoRank = 0; fifoRank < sortedGuests.length; fifoRank++) {
    const guest = sortedGuests[fifoRank];

    // Hard constraints: capacity + gender compatibility
    const eligibleHosts = availableHosts.filter((h) => h.remaining_capacity >= guest.attending_count && isGenderCompatible(guest, h));

    for (const host of eligibleHosts) {
      const { score, reasons } = scoreMatch(guest, host, fifoRank, sortedGuests.length, opts);
      suggestions.push({ guest, host, score, reasons });
    }
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.score - a.score);

  return suggestions;
}

// --- Best Allocation (maximize total guests accommodated) ---

export type AllocationResult = {
  matched: MatchSuggestion[];
  unmatched: GuestRow[];
  unassignedHosts: HostRow[];
};

/**
 * Best-fit decreasing allocation: maximize total guests accommodated.
 *
 * Strategy (bin-packing inspired):
 * 1. Priority tiers: elders (65+) → single women → infants (<2) → rest.
 * 2. Within each tier sort LARGEST families first — they are hardest to place,
 *    so giving them first pick avoids capacity fragmentation.
 * 3. Host selection uses a composite: quality score + tightness bonus.
 *    The tightness bonus (up to 25 pts) rewards hosts whose remaining capacity
 *    closely matches the guest count, preserving bigger hosts for bigger families.
 * 4. After the first pass, any unmatched guests get a retry pass against updated
 *    capacity (in case earlier placements opened better fits).
 */
export async function suggestBestAllocation(opts?: ScoringOptions): Promise<AllocationResult> {
  const [guests, hosts] = await Promise.all([buildGuestRollups(), buildHostRollups()]);

  const unmatchedGuests = guests.filter((g) => g.current_match_status == null && g.attending_count > 0);

  // Priority tiers
  const hasElder = (g: GuestRow) => g.ages.split(", ").some((a) => parseInt(a) >= 65);
  const isSingleWoman = (g: GuestRow) => g.attending_count === 1 && g.female_count === 1 && g.male_count === 0;
  const hasInfant = (g: GuestRow) => g.ages.split(", ").some((a) => { const n = parseInt(a); return !isNaN(n) && n < 2; });

  const priorityTier = (g: GuestRow): number => {
    if (hasElder(g)) return 0;
    if (isSingleWoman(g)) return 1;
    if (hasInfant(g)) return 2;
    return 3;
  };

  // Sort: priority tier ascending, then LARGEST family first within tier
  const sortedGuests = [...unmatchedGuests].sort((a, b) => {
    const aTier = priorityTier(a);
    const bTier = priorityTier(b);
    if (aTier !== bTier) return aTier - bTier;
    return b.attending_count - a.attending_count; // largest first
  });

  // Track remaining capacity during allocation
  const capacityLeft = new Map<string, number>();
  const availableHosts = hosts.filter((h) => h.remaining_capacity > 0 && h.enabled_for_suggestions);
  for (const h of availableHosts) {
    capacityLeft.set(h.id, h.remaining_capacity);
  }

  const matched: MatchSuggestion[] = [];
  const retryList: GuestRow[] = [];

  // Scoring without FIFO for allocation mode
  const allocOpts: ScoringOptions = { ...opts, fifo: false };

  // Helper: pick best host for a guest considering tightness
  function pickBestHost(guest: GuestRow): { host: HostRow; score: number; reasons: string[] } | null {
    const eligible = availableHosts.filter(
      (h) => (capacityLeft.get(h.id) ?? 0) >= guest.attending_count && isGenderCompatible(guest, h),
    );
    if (eligible.length === 0) return null;

    let best: { host: HostRow; score: number; reasons: string[] } | null = null;
    for (const host of eligible) {
      const { score: qualityScore, reasons } = scoreMatch(guest, host, 0, sortedGuests.length, allocOpts);

      // Tightness bonus: reward hosts whose remaining capacity closely matches guest size.
      // A perfect fit (cap == attending) gets 25 pts; excess capacity reduces the bonus.
      const cap = capacityLeft.get(host.id) ?? 0;
      const waste = cap - guest.attending_count;
      const tightnessBonus = Math.max(0, 25 * (1 - waste / Math.max(cap, 1)));

      const compositeScore = qualityScore + tightnessBonus;
      if (!best || compositeScore > best.score) {
        best = { host, score: Math.round(compositeScore * 10) / 10, reasons };
      }
    }
    return best;
  }

  // --- First pass ---
  for (const guest of sortedGuests) {
    const best = pickBestHost(guest);
    if (best) {
      matched.push({ guest, host: best.host, score: best.score, reasons: best.reasons });
      capacityLeft.set(best.host.id, (capacityLeft.get(best.host.id) ?? 0) - guest.attending_count);
    } else {
      retryList.push(guest);
    }
  }

  // --- Second pass: retry unmatched (capacity landscape may have changed) ---
  const finalUnmatched: GuestRow[] = [];
  for (const guest of retryList) {
    const best = pickBestHost(guest);
    if (best) {
      matched.push({ guest, host: best.host, score: best.score, reasons: best.reasons });
      capacityLeft.set(best.host.id, (capacityLeft.get(best.host.id) ?? 0) - guest.attending_count);
    } else {
      finalUnmatched.push(guest);
    }
  }

  // Hosts that received no allocation
  const assignedHostIds = new Set(matched.map((m) => m.host.id));
  const unassignedHosts = availableHosts.filter((h) => !assignedHostIds.has(h.id));

  return { matched, unmatched: finalUnmatched, unassignedHosts };
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
 * Deletes the match row so both host and guest return to the pool.
 */
export async function rejectMatch(matchId: string): Promise<void> {
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

  // Delete the match row entirely
  const { error: deleteErr } = await supabase
    .from("accommodation_matches")
    .delete()
    .eq("id", matchId);

  if (deleteErr) throw new Error(`Failed to delete match: ${deleteErr.message}`);
}
