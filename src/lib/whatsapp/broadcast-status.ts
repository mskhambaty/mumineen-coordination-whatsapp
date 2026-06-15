import { getSupabaseAdmin } from "@/lib/supabase/server";
import { recordUndeliverable } from "@/lib/whatsapp/undeliverable";

// Meta delivery-status callbacks (sent/delivered/read/failed) arrive on the same webhook as
// inbound messages, under entry[].changes[].value.statuses[]. We correlate them back to broadcast
// recipients by the Meta message id (wa_message_id) and advance the recipient's status, so the
// console log can show delivered/read. "replied" is set separately when an inbound message comes
// from a number we recently broadcast to.

// `errorDetail` is present only for failed statuses that carried a Meta error[] entry — it holds a
// concise "<code>: <title>" (plus a friendly hint for common codes), never any PII. `errorCode` is
// the raw numeric Meta code (when present) so the undeliverable-suppression logic can match specific
// codes without parsing the string.
export type WaStatusUpdate = { waMessageId: string; status: string; timestamp: number | null; errorDetail?: string; errorCode?: number };

// Plain-language hints for the failure codes that dominate large broadcasts, so non-technical admins
// reading the failures CSV understand them. Anything not listed falls back to just "<code>: <title>".
const KNOWN_WA_ERRORS: Record<number, string> = {
  131049: "Meta engagement/frequency cap — recipient throttled",
  131026: "Undeliverable — number not on WhatsApp / can't receive",
  131047: "Re-engagement required (outside 24h window, no template eligibility)",
  130472: "Recipient in a Meta experiment group — not delivered",
};

// Build a concise, PII-free failure reason from a Meta status error[] entry. Meta's title/message
// describe the failure class (not the person), so they are safe to store; we deliberately ignore
// recipient_id and any phone-like fields.
function formatStatusError(errors: unknown): string | undefined {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const e = errors[0] as { code?: unknown; title?: unknown; message?: unknown; error_data?: { details?: unknown } };
  const code = typeof e.code === "number" ? e.code : null;
  const title =
    (typeof e.title === "string" && e.title.trim()) ||
    (typeof e.error_data?.details === "string" && e.error_data.details.trim()) ||
    (typeof e.message === "string" && e.message.trim()) ||
    "Delivery failed";
  const base = code !== null ? `${code}: ${title}` : title;
  const hint = code !== null ? KNOWN_WA_ERRORS[code] : undefined;
  return hint ? `${base} (${hint})` : base;
}

// Pull the raw numeric Meta error code out of a status error[] entry, if present.
function statusErrorCode(errors: unknown): number | undefined {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const code = (errors[0] as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

// Pull status updates out of a raw webhook payload. Returns [] for message-only payloads.
export function extractStatusUpdates(payload: unknown): WaStatusUpdate[] {
  const out: WaStatusUpdate[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown[] } })?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses) {
        const row = s as { id?: unknown; status?: unknown; timestamp?: unknown; errors?: unknown };
        if (typeof row.id === "string" && typeof row.status === "string") {
          const tsNum = typeof row.timestamp === "string" ? Number(row.timestamp) : null;
          const update: WaStatusUpdate = { waMessageId: row.id, status: row.status, timestamp: Number.isFinite(tsNum) ? tsNum : null };
          const errorDetail = formatStatusError(row.errors);
          if (errorDetail) update.errorDetail = errorDetail;
          const errorCode = statusErrorCode(row.errors);
          if (errorCode !== undefined) update.errorCode = errorCode;
          out.push(update);
        }
      }
    }
  }
  return out;
}

// Status precedence so a late 'delivered' can't downgrade a 'read'.
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, replied: 4, failed: 1 };

// Apply delivery-status updates to broadcast recipients (best-effort; unmatched ids are ignored —
// most statuses are for non-broadcast messages).
export async function applyBroadcastStatuses(updates: WaStatusUpdate[]): Promise<number> {
  if (updates.length === 0) return 0;
  const supabase = getSupabaseAdmin();
  let applied = 0;

  for (const u of updates) {
    const { data: recip } = await supabase
      .from("template_broadcast_recipients")
      .select("id, send_status, phone_e164")
      .eq("wa_message_id", u.waMessageId)
      .maybeSingle();
    if (!recip) continue;

    // A number Meta reports as undeliverable (not on WhatsApp / can't receive) gets counted toward
    // suppression so we stop re-sending to it. Only count the FIRST transition into 'failed' for this
    // recipient row: Meta can redeliver a status webhook (at-least-once), and double-counting a single
    // real failure would suppress a number prematurely. Distinct broadcasts use distinct recipient
    // rows, so this still counts genuine repeat failures. No-op for non-undeliverable codes.
    if (u.status === "failed" && recip.send_status !== "failed") {
      await recordUndeliverable(recip.phone_e164, u.errorCode);
    }

    const next = u.status === "failed" ? "failed" : u.status;
    if ((RANK[next] ?? -1) <= (RANK[recip.send_status] ?? -1) && next !== "failed") continue;

    const patch: Record<string, unknown> = { send_status: next };
    const iso = u.timestamp ? new Date(u.timestamp * 1000).toISOString() : new Date().toISOString();
    if (next === "delivered") patch.delivered_at = iso;
    if (next === "read") patch.read_at = iso;
    // Persist Meta's failure reason so the failures CSV / rollup shows the real cause instead of the
    // window-based fallback. Only write when we actually have a reason — never clobber with null.
    if (next === "failed" && u.errorDetail) patch.error_detail = u.errorDetail;

    await supabase.from("template_broadcast_recipients").update(patch).eq("id", recip.id);
    applied++;
  }
  return applied;
}

// Mark a phone's most recent (within 3 days) broadcast recipient row as 'replied' when they message
// back. Cheap signal for the console's reply tracking.
export async function markBroadcastReplied(phoneE164: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recip } = await supabase
    .from("template_broadcast_recipients")
    .select("id, sent_at")
    .eq("phone_e164", phoneE164)
    .gte("sent_at", cutoff)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!recip) return;
  await supabase
    .from("template_broadcast_recipients")
    .update({ send_status: "replied", replied_at: new Date().toISOString() })
    .eq("id", recip.id);
}
