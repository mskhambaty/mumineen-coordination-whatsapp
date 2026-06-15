// Shareable deep links to a specific webinar on the public /webinars grid.
// Opening such a link auto-opens that webinar's player (see src/app/webinars/page.tsx).
// A webinar's `seq` is the public, human-friendly identifier used in the link.

export const WEBINAR_SHARE_PARAM = "w";

/**
 * Build a shareable URL to a single webinar, e.g.
 * webinarShareUrl("https://example.com", 3) -> "https://example.com/webinars?w=3".
 * `origin` is typically window.location.origin; a trailing slash is tolerated.
 */
export function webinarShareUrl(origin: string, seq: number | string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/webinars?${WEBINAR_SHARE_PARAM}=${seq}`;
}
