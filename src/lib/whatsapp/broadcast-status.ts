import { getSupabaseAdmin } from "@/lib/supabase/server";

// Meta delivery-status callbacks (sent/delivered/read/failed) arrive on the same webhook as
// inbound messages, under entry[].changes[].value.statuses[]. We correlate them back to broadcast
// recipients by the Meta message id (wa_message_id) and advance the recipient's status, so the
// console log can show delivered/read. "replied" is set separately when an inbound message comes
// from a number we recently broadcast to.

export type WaStatusUpdate = { waMessageId: string; status: string; timestamp: number | null };

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
        const row = s as { id?: unknown; status?: unknown; timestamp?: unknown };
        if (typeof row.id === "string" && typeof row.status === "string") {
          const tsNum = typeof row.timestamp === "string" ? Number(row.timestamp) : null;
          out.push({ waMessageId: row.id, status: row.status, timestamp: Number.isFinite(tsNum) ? tsNum : null });
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
      .select("id, send_status")
      .eq("wa_message_id", u.waMessageId)
      .maybeSingle();
    if (!recip) continue;

    const next = u.status === "failed" ? "failed" : u.status;
    if ((RANK[next] ?? -1) <= (RANK[recip.send_status] ?? -1) && next !== "failed") continue;

    const patch: Record<string, unknown> = { send_status: next };
    const iso = u.timestamp ? new Date(u.timestamp * 1000).toISOString() : new Date().toISOString();
    if (next === "delivered") patch.delivered_at = iso;
    if (next === "read") patch.read_at = iso;

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
