// Client-safe channel marker for in-app agent chat messages (see src/lib/conversations/in-app.ts).
// In-app rows carry raw_payload.channel = "in_app"; WhatsApp rows don't.

export const IN_APP_CHANNEL = "in_app";

export function isInAppPayload(rawPayload: unknown): boolean {
  return (rawPayload as { channel?: unknown } | null)?.channel === IN_APP_CHANNEL;
}
