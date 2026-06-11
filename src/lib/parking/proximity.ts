// Proximity rules for parking pass allocation.
// Pure functions — no Supabase imports, fully testable.
// Rule: for a family with multiple passes, exactly ONE pass stays in the
// "anchor" lot; all others must be in the designated overflow lot.

// Priority order for anchor detection (last = highest wins).
// Red is intentionally absent — it is never an anchor, only an overflow destination.
export const ANCHOR_PRIORITY = ["blue", "white", "gold"] as const;
export type AnchorColor = (typeof ANCHOR_PRIORITY)[number];

// For each anchor color: primary overflow destination and fallback when primary is full.
export const OVERFLOW: Record<AnchorColor, { primary: string; fallback: string | null }> = {
  gold:  { primary: "red",  fallback: "blue" },
  white: { primary: "red",  fallback: "blue" },
  blue:  { primary: "blue", fallback: null },   // Hillside stays Hillside; soft-warn if full
};

// Determine the highest-priority anchor color in a set of lot colors.
// Returns null when no anchor-eligible color is present (e.g., all red).
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
  anchor_pass_id: string;   // the single anchor pass to keep unchanged
  anchor_color: AnchorColor;
  overflow_primary: string; // color all other passes should be
  overflow_fallback: string | null;
  passes_to_revoke: string[]; // IDs of passes that violate proximity
};

// Detect which families have passes that violate proximity rules.
// `passes` in each family should be sorted by created_at ascending so the
// oldest pass is chosen as the anchor when multiple share the same anchor color.
export function detectProximityIssues(
  families: { family_id: string; passes: PassRef[] }[],
): ProximityIssue[] {
  const issues: ProximityIssue[] = [];

  for (const { family_id, passes } of families) {
    if (passes.length <= 1) continue;

    const anchor = getAnchorColor(passes.map((p) => p.lot_color));
    if (!anchor) continue; // all red or unknown — no proximity rule applies

    const { primary, fallback } = OVERFLOW[anchor];

    // The first pass found in the anchor color is the one we keep.
    const anchorPass = passes.find((p) => (p.lot_color ?? "").toLowerCase() === anchor);
    if (!anchorPass) continue;

    const toRevoke = passes.filter((p) => {
      if (p.id === anchorPass.id) return false;
      return (p.lot_color ?? "").toLowerCase() !== primary;
    });

    if (toRevoke.length === 0) continue;

    issues.push({
      family_id,
      anchor_pass_id: anchorPass.id,
      anchor_color: anchor,
      overflow_primary: primary,
      overflow_fallback: fallback,
      passes_to_revoke: toRevoke.map((p) => p.id),
    });
  }

  return issues;
}

// Returns the conflicting anchor color if adding a pass in `targetColor` would violate
// proximity rules for a family that already has passes in `existingColors`, or null
// when clean. Used for the bulk-assign warning in the admin UI.
export function proximityConflict(
  existingColors: (string | null)[],
  targetColor: string | null,
): AnchorColor | null {
  if (existingColors.length === 0) return null;
  const anchor = getAnchorColor(existingColors);
  if (!anchor) return null;
  const { primary } = OVERFLOW[anchor];
  const target = (targetColor ?? "").toLowerCase();
  if (target === anchor || target === primary) return null;
  return anchor;
}
