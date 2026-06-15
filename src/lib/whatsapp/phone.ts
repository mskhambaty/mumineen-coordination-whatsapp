// Phone-number normalization shared across the WhatsApp modules. Kept in its own leaf module (no
// other imports) so both audience.ts and undeliverable.ts can use it without an import cycle.

// Normalize a phone string to "+<digits>" so it keys/dedupes consistently across audiences, broadcast
// recipient rows, the in-window set, and the undeliverable suppression list.
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : input;
}
