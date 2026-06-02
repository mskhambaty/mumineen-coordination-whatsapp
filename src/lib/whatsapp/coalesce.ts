import crypto from "node:crypto";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const LOCK_TTL_SECONDS = 180;

export const COALESCE_DEBOUNCE_MS = (() => {
  const raw = Number(process.env.WA_COALESCE_DEBOUNCE_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return process.env.VITEST ? 0 : 2500;
})();

const MAX_DRAIN_PASSES = 6;

const LOCKS = "whatsapp_inbound_locks";
const PENDING = "whatsapp_pending_messages";

const PG_UNIQUE_VIOLATION = "23505";

export type PendingInsert = {
  lockKey: string;
  phoneE164: string;
  messageId: string;
  body: string;
  inboundMsgId: string | null;
};

type ClaimedRow = {
  id: string;
  body: string;
  received_at: string;
  inbound_msg_id: string | null;
};

export async function insertPendingMessage(p: PendingInsert): Promise<void> {
  const { error } = await getSupabaseAdmin().from(PENDING).insert([
    {
      lock_key: p.lockKey,
      phone_e164: p.phoneE164,
      message_id: p.messageId,
      body: p.body,
      inbound_msg_id: p.inboundMsgId,
    },
  ]);
  if (error && error.code !== PG_UNIQUE_VIOLATION) {
    console.error("[wa-coalesce] insertPendingMessage failed:", error.message);
    throw new Error(error.message);
  }
}

async function acquireLock(lockKey: string, token: string, ttlSeconds: number): Promise<boolean> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const ins = await getSupabaseAdmin()
    .from(LOCKS)
    .insert([{ lock_key: lockKey, owner_token: token, expires_at: expiresAt }])
    .select("lock_key");
  if (!ins.error) return true;
  if (ins.error.code !== PG_UNIQUE_VIOLATION) {
    console.error("[wa-coalesce] acquireLock insert failed:", ins.error.message);
    return false;
  }

  const nowIso = new Date().toISOString();
  const upd = await getSupabaseAdmin()
    .from(LOCKS)
    .update({ owner_token: token, acquired_at: nowIso, expires_at: expiresAt })
    .eq("lock_key", lockKey)
    .lt("expires_at", nowIso)
    .select("lock_key");
  if (upd.error) {
    console.error("[wa-coalesce] acquireLock steal failed:", upd.error.message);
    return false;
  }
  return (upd.data?.length ?? 0) > 0;
}

async function renewLock(lockKey: string, token: string, ttlSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await getSupabaseAdmin()
    .from(LOCKS)
    .update({ expires_at: expiresAt })
    .eq("lock_key", lockKey)
    .eq("owner_token", token);
  if (error) console.error("[wa-coalesce] renewLock failed:", error.message);
}

async function releaseLock(lockKey: string, token: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from(LOCKS)
    .delete()
    .eq("lock_key", lockKey)
    .eq("owner_token", token);
  if (error) console.error("[wa-coalesce] releaseLock failed:", error.message);
}

async function isStillOwner(lockKey: string, token: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from(LOCKS)
    .select("owner_token, expires_at")
    .eq("lock_key", lockKey)
    .maybeSingle();
  if (error || !data) return false;
  return data.owner_token === token && new Date(data.expires_at).getTime() > Date.now();
}

async function claimPending(
  lockKey: string,
  token: string,
  staleSeconds: number,
): Promise<ClaimedRow[]> {
  const staleIso = new Date(Date.now() - staleSeconds * 1000).toISOString();
  const cols = "id, body, received_at, inbound_msg_id";

  const fresh = await getSupabaseAdmin()
    .from(PENDING)
    .update({ claimed_at: new Date().toISOString(), claimed_by: token })
    .eq("lock_key", lockKey)
    .is("claimed_at", null)
    .select(cols);
  if (fresh.error) {
    console.error("[wa-coalesce] claimPending (fresh) failed:", fresh.error.message);
    return [];
  }

  const stale = await getSupabaseAdmin()
    .from(PENDING)
    .update({ claimed_at: new Date().toISOString(), claimed_by: token })
    .eq("lock_key", lockKey)
    .lt("claimed_at", staleIso)
    .select(cols);
  if (stale.error) {
    console.error("[wa-coalesce] claimPending (stale) failed:", stale.error.message);
    return sortByReceived(fresh.data ?? []);
  }

  return sortByReceived([...(fresh.data ?? []), ...(stale.data ?? [])]);
}

function sortByReceived(rows: ClaimedRow[]): ClaimedRow[] {
  return rows.sort(
    (a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime(),
  );
}

async function deleteClaimed(lockKey: string, token: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from(PENDING)
    .delete()
    .eq("lock_key", lockKey)
    .eq("claimed_by", token);
  if (error) console.error("[wa-coalesce] deleteClaimed failed:", error.message);
}

export type SettleCtx<R> = {
  inboundMsgIds: string[];
  result: R | null;
  error: unknown | null;
  sent: boolean;
};

export async function runCoalescedInbound<R>(opts: {
  lockKey: string;
  process: (combinedText: string) => Promise<R>;
  send: (result: R) => Promise<void>;
  settle?: (ctx: SettleCtx<R>) => Promise<void>;
}): Promise<{ ran: boolean }> {
  const token = crypto.randomUUID();
  const acquired = await acquireLock(opts.lockKey, token, LOCK_TTL_SECONDS);
  if (!acquired) return { ran: false };

  if (COALESCE_DEBOUNCE_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, COALESCE_DEBOUNCE_MS));
  }

  const inboundMsgIds: string[] = [];
  let result: R | null = null;
  let error: unknown | null = null;
  let sent = false;

  try {
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
      const claimed = await claimPending(opts.lockKey, token, LOCK_TTL_SECONDS);
      if (claimed.length === 0) break;
      const batch: string[] = [];
      for (const c of claimed) {
        if (c.inbound_msg_id) inboundMsgIds.push(c.inbound_msg_id);
        batch.push(c.body);
      }
      result = await opts.process(batch.join("\n\n"));
      await renewLock(opts.lockKey, token, LOCK_TTL_SECONDS);
    }

    if (result !== null && (await isStillOwner(opts.lockKey, token))) {
      await opts.send(result);
      sent = true;
      await deleteClaimed(opts.lockKey, token);
    }
  } catch (e) {
    error = e;
    console.error("[wa-coalesce] runCoalescedInbound error:", e);
  } finally {
    if (opts.settle) {
      try {
        await opts.settle({ inboundMsgIds, result, error, sent });
      } catch (e) {
        console.error("[wa-coalesce] settle error:", e);
      }
    }
    await releaseLock(opts.lockKey, token);
  }

  return { ran: true };
}
