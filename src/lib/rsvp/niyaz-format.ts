// Shorten a member's name for the family_members list: keep all words up to AND INCLUDING the first
// "bhai" / "bai" token (e.g. "Mustafa Bhai Khambaty" → "Mustafa Bhai"). If neither appears, keep the
// whole name. Punctuation on the token is ignored so "bhai," matches.
export function shortFamilyName(name: string | null | undefined): string {
  if (!name) return "";
  const words = name.trim().split(/\s+/).filter(Boolean);
  const idx = words.findIndex((w) => {
    const l = w.toLowerCase().replace(/[^a-z]/g, "");
    return l === "bhai" || l === "bai";
  });
  return (idx === -1 ? words : words.slice(0, idx + 1)).join(" ");
}

// Format a niyaz RSVP cutoff instant (ISO timestamptz) for display in templates / messages, in the
// event's local timezone. Pure (no imports) so it's safe in both client and server bundles.
export function formatNiyazEndTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
