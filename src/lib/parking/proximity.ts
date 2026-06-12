// Proximity rules for parking pass allocation.
// Pure functions — no Supabase imports, fully testable.
//
// Two geographic groups:
//   Venue   — Gold (VIP), White (Church), Red (Mecca): all at/near the same venue.
//             Any combination within this group is acceptable.
//   Hillside — Blue only: geographically separate from the venue lots.
//
// A family has a proximity issue when their passes span BOTH groups.
//
// Fix direction is determined by the highest-priority anchor:
//   Gold > White present → Venue is the anchor → revoke Blue, assign Red (Mecca)
//   Blue + Red only (no Gold/White) → Hillside is the anchor → revoke Red, assign Blue

// Priority for display/anchor detection within the Venue group (Gold wins over White).
export const ANCHOR_PRIORITY = ["white", "gold"] as const;
export type AnchorColor = (typeof ANCHOR_PRIORITY)[number];

// Fixed overflow when fixing Blue passes for a Venue-anchor family.
export const OVERFLOW_PRIMARY = "red";   // Mecca Center
export const OVERFLOW_FALLBACK = "blue"; // fallback if Mecca is full (soft-warn)

function isVenueAnchor(color: string | null): color is AnchorColor {
  return ANCHOR_PRIORITY.includes((color ?? "").toLowerCase() as AnchorColor);
}

function isVenueColor(color: string | null): boolean {
  return ["gold", "white", "red"].includes((color ?? "").toLowerCase());
}

// Determine the highest-priority Venue anchor color (Gold > White) in a set of lot colors.
// Returns null when no anchor-eligible color (Gold/White) is present.
export function getAnchorColor(lotColors: (string | null)[]): AnchorColor | null {
  let best: AnchorColor | null = null;
  let bestIdx = -1;
  for (const color of lotColors) {
    const key = (color ?? "").toLowerCase();
    const idx = ANCHOR_PRIORITY.indexOf(key as AnchorColor);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = key as AnchorColor;
    }
  }
  return best;
}

export type PassRef = { id: string; lot_id: string; lot_color: string | null };

export type ProximityIssue = {
  family_id: string;
  anchor_pass_id: string;   // display: first pass of the anchor color
  anchor_color: string;     // display: "gold", "white", or "blue"
  overflow_primary: string; // lot color to assign replacements in
  overflow_fallback: string | null;
  passes_to_revoke: string[]; // IDs of misallocated passes
};

// Detect families whose passes span both geographic groups.
// Passes in each family should be sorted by created_at ascending.
export function detectProximityIssues(
  families: { family_id: string; passes: PassRef[] }[],
): ProximityIssue[] {
  const issues: ProximityIssue[] = [];

  for (const { family_id, passes } of families) {
    if (passes.length <= 1) continue;

    const hasVenueAnchor = passes.some((p) => isVenueAnchor(p.lot_color));          // Gold or White
    const hasBlue = passes.some((p) => (p.lot_color ?? "").toLowerCase() === "blue");
    const hasRed = passes.some((p) => (p.lot_color ?? "").toLowerCase() === "red");

    let toRevoke: typeof passes;
    let overflowPrimary: string;
    let overflowFallback: string | null;
    let anchorColor: string;

    if (hasVenueAnchor && hasBlue) {
      // Case 1: family has a VIP/Church anchor → Blue passes must move to Mecca (Red).
      toRevoke = passes.filter((p) => (p.lot_color ?? "").toLowerCase() === "blue");
      overflowPrimary = "red";
      overflowFallback = "blue"; // if Red is full: soft-warn, leave at Blue
      anchorColor = getAnchorColor(passes.map((p) => p.lot_color)) ?? "white";
    } else if (hasBlue && hasRed && !hasVenueAnchor) {
      // Case 2: Hillside anchor (no Gold/White) → Red passes must move to Hillside (Blue).
      toRevoke = passes.filter((p) => (p.lot_color ?? "").toLowerCase() === "red");
      overflowPrimary = "blue";
      overflowFallback = null; // if Blue is full: soft-warn, proceed anyway
      anchorColor = "blue";
    } else {
      continue; // no cross-group issue
    }

    if (toRevoke.length === 0) continue;

    const anchorPass = passes.find((p) => (p.lot_color ?? "").toLowerCase() === anchorColor);

    issues.push({
      family_id,
      anchor_pass_id: anchorPass?.id ?? passes[0].id,
      anchor_color: anchorColor,
      overflow_primary: overflowPrimary,
      overflow_fallback: overflowFallback,
      passes_to_revoke: toRevoke.map((p) => p.id),
    });
  }

  return issues;
}

// Returns true if adding a pass in `targetColor` to a family with `existingColors`
// would create a cross-group proximity conflict. Used for the bulk-assign warning.
export function proximityConflict(
  existingColors: (string | null)[],
  targetColor: string | null,
): boolean {
  if (existingColors.length === 0) return false;
  const target = (targetColor ?? "").toLowerCase();
  const hasVenueAnchor = existingColors.some((c) => isVenueAnchor(c));
  const hasBlue = existingColors.some((c) => (c ?? "").toLowerCase() === "blue");
  const hasRed = existingColors.some((c) => (c ?? "").toLowerCase() === "red");
  const targetIsVenue = isVenueColor(targetColor);
  const targetIsBlue = target === "blue";

  // Adding Blue to a family with a VIP/Church anchor
  if (hasVenueAnchor && targetIsBlue) return true;
  // Adding VIP/Church to a Blue family
  if (hasBlue && !hasVenueAnchor && isVenueAnchor(targetColor)) return true;
  // Adding Red to a Hillside-only family (no Gold/White)
  if (hasBlue && !hasVenueAnchor && !hasRed && target === "red") return true;
  // Adding Blue to a Red-only family (no Gold/White)
  if (hasRed && !hasVenueAnchor && !hasBlue && targetIsBlue) return true;

  void targetIsVenue; // suppress unused-variable lint
  return false;
}
