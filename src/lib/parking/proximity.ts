// Proximity rules for parking pass allocation.
// Pure functions — no Supabase imports, fully testable.
//
// Geographic proximity groups:
//   Group A — VIP (Gold), Church (White), Mecca Center (Red): all at/near the same venue.
//             Any combination within this group is acceptable.
//   Group B — Hillside Ln (Blue): geographically separate.
//
// A family has a proximity issue when they hold passes in BOTH groups.
// Fix: revoke all Blue (Group B) passes, replace with Red (Mecca Center, Group A).

// Anchor colors for display and priority ranking.
// Red is intentionally excluded — it is only an overflow destination, not an anchor.
export const ANCHOR_PRIORITY = ["white", "gold"] as const;
export type AnchorColor = (typeof ANCHOR_PRIORITY)[number];

// Fixed overflow targets when fixing Group B (Blue) passes.
export const OVERFLOW_PRIMARY = "red";   // Mecca Center
export const OVERFLOW_FALLBACK = "blue"; // fallback if Mecca is full (soft-warn)

function isAnchorColor(color: string | null): color is AnchorColor {
  return ANCHOR_PRIORITY.includes((color ?? "").toLowerCase() as AnchorColor);
}

// Determine the highest-priority anchor color (Gold > White) among a set of lot colors.
// Returns null when no anchor-eligible color is present.
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
  anchor_pass_id: string;   // first Group A pass, used for display (anchor lot name)
  anchor_color: AnchorColor;
  overflow_primary: string; // always "red"
  overflow_fallback: string; // always "blue"
  passes_to_revoke: string[]; // all Blue (Group B) passes to revoke
};

// Detect families whose passes span both geographic groups.
// `passes` in each family should be sorted by created_at ascending.
export function detectProximityIssues(
  families: { family_id: string; passes: PassRef[] }[],
): ProximityIssue[] {
  const issues: ProximityIssue[] = [];

  for (const { family_id, passes } of families) {
    if (passes.length <= 1) continue;

    // Issue: family has at least one Group A (Gold/White) anchor pass AND at least one Blue pass.
    // Gold+White, White+White, Gold+White+Red etc. are all fine — no cross-group mixing.
    const hasAnchor = passes.some((p) => isAnchorColor(p.lot_color));
    const hasBlue = passes.some((p) => (p.lot_color ?? "").toLowerCase() === "blue");

    if (!hasAnchor || !hasBlue) continue;

    // Revoke all Blue (Group B) passes.
    const toRevoke = passes.filter((p) => (p.lot_color ?? "").toLowerCase() === "blue");
    if (toRevoke.length === 0) continue;

    // Pick the highest-priority Group A pass as the display anchor.
    const anchor = getAnchorColor(passes.map((p) => p.lot_color)) ?? "white";
    const anchorPass = passes.find((p) => (p.lot_color ?? "").toLowerCase() === anchor);

    issues.push({
      family_id,
      anchor_pass_id: anchorPass?.id ?? passes[0].id,
      anchor_color: anchor,
      overflow_primary: OVERFLOW_PRIMARY,
      overflow_fallback: OVERFLOW_FALLBACK,
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
  const hasAnchor = existingColors.some((c) => isAnchorColor(c));
  const hasBlue = existingColors.some((c) => (c ?? "").toLowerCase() === "blue");
  // Adding Blue to a family that already has a Group A anchor pass
  if (hasAnchor && target === "blue") return true;
  // Adding a Group A anchor pass to a Blue-only family
  if (hasBlue && !hasAnchor && isAnchorColor(targetColor)) return true;
  return false;
}
