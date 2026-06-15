import { normalizePhone } from "@/lib/whatsapp/phone";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Undeliverable-number suppression. When Meta reports a delivery-status failure whose error code
// means the number isn't on WhatsApp / can't receive, we count it per number. Once a number crosses
// UNDELIVERABLE_FAIL_THRESHOLD distinct failures it is marked 'suppressed', and the audience layer
// (previewExplicitRecipients + createBroadcast) drops it from every future broadcast so we stop
// re-sending and re-paying for messages that can't land. An admin can un-flag a number, which clears
// suppression and resets the counter (so a corrected/recycled number gets a fresh start). All data is
// keyed by phone and lives in the RLS-protected whatsapp_undeliverable table — never logged.

// Two failures before we suppress: a single failure can be transient ("can't currently receive"),
// but a number that fails twice across separate broadcasts is almost certainly dead/not-on-WhatsApp.
// This deliberately errs toward delivering one extra (wasted) message over silently dropping a real
// family — the worse failure mode for a community service.
export const UNDELIVERABLE_FAIL_THRESHOLD = 2;

// Meta error codes that mean "this number can't receive" (vs. throttling / window / experiment, which
// are not the number's fault and must NOT suppress it). 131026 = undeliverable / not on WhatsApp.
export const UNDELIVERABLE_ERROR_CODES = new Set<number>([131026]);

export function isUndeliverableErrorCode(code: number | null | undefined): boolean {
  return code != null && UNDELIVERABLE_ERROR_CODES.has(code);
}

// Record one undeliverable failure for a number (atomic upsert + suppression recompute in the DB).
// No-op for codes that aren't "number can't receive". Best-effort: logs (an opaque code, never the
// phone) and swallows errors so a status-webhook handler never fails on this side effect.
export async function recordUndeliverable(phoneE164: string, errorCode: number | null | undefined): Promise<void> {
  if (!isUndeliverableErrorCode(errorCode) || !phoneE164) return;
  const phone = normalizePhone(phoneE164);
  const { error } = await getSupabaseAdmin().rpc("record_whatsapp_undeliverable", {
    p_phone: phone,
    p_error_code: errorCode,
    p_threshold: UNDELIVERABLE_FAIL_THRESHOLD,
  });
  if (error) console.error("Failed to record undeliverable number:", { error_code: errorCode, error: error.message });
}

// Normalized set of phone numbers currently suppressed (will be skipped on all sends). Used by the
// audience layer to subtract dead numbers from every broadcast.
export async function suppressedPhones(): Promise<Set<string>> {
  const out = new Set<string>();
  const supabase = getSupabaseAdmin();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("whatsapp_undeliverable")
      .select("phone_e164")
      .eq("suppressed", true)
      .order("phone_e164", { ascending: true })
      .range(from, from + PAGE - 1);
    const rows = (data ?? []) as { phone_e164: string }[];
    for (const r of rows) out.add(normalizePhone(r.phone_e164));
    if (rows.length < PAGE) break;
  }
  return out;
}

export type SuppressedNumber = {
  phone_e164: string;
  fail_count: number;
  last_error_code: number | null;
  first_failed_at: string;
  last_failed_at: string;
  suppressed_at: string | null;
};

// All currently-suppressed numbers (newest failure first) for the admin management view.
export async function listSuppressed(): Promise<SuppressedNumber[]> {
  const { data } = await getSupabaseAdmin()
    .from("whatsapp_undeliverable")
    .select("phone_e164, fail_count, last_error_code, first_failed_at, last_failed_at, suppressed_at")
    .eq("suppressed", true)
    .order("last_failed_at", { ascending: false });
  return (data ?? []) as SuppressedNumber[];
}

// Un-flag a number: clear suppression and reset the failure counter so it's eligible for sends again
// (a corrected/recycled number gets a clean slate — it would take a fresh run of failures to
// re-suppress). Returns true if a suppressed row was actually cleared.
export async function clearUndeliverable(phoneE164: string, clearedBy: string | null): Promise<boolean> {
  const phone = normalizePhone(phoneE164);
  const { data } = await getSupabaseAdmin()
    .from("whatsapp_undeliverable")
    .update({
      suppressed: false,
      suppressed_at: null,
      fail_count: 0,
      cleared_at: new Date().toISOString(),
      cleared_by: clearedBy,
    })
    .eq("phone_e164", phone)
    .select("phone_e164");
  return (data ?? []).length > 0;
}
