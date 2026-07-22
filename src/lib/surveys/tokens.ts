import { randomBytes } from "crypto";

// Opaque, URL-safe per-recipient survey token. Baked into the recipient's WhatsApp link as the
// dynamic URL suffix; maps back to exactly one (mumin, form) when they open/submit the form.
export function generateSurveyToken(): string {
  return randomBytes(24).toString("base64url");
}

// Today's date in the event timezone (America/Chicago), YYYY-MM-DD — matches feedback/rsvp/digest.
export function chicagoToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
