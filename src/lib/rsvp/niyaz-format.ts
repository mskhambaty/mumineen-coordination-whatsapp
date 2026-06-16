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
