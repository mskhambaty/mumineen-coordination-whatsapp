import { previewAudience, utilityMessageCostUsd, type AudienceKey } from "@/lib/whatsapp/audience";
import { resolveApprovedTemplate, sendTemplateNotification } from "@/lib/whatsapp/send-template";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Broadcast engine for the manual template-send console. A broadcast is created with all its
// recipients enqueued ('queued'), then drained in throttled batches by a cron so the work survives
// serverless time limits and naturally rate-limits the fan-out. All sends go through the shared
// sendTemplateNotification pipeline (logging, no PII leakage). Templates here are no-variable
// (the three approved Ashara templates), so bodyParams is empty.

const DEFAULT_BATCH_SIZE = 150; // per drain invocation; ~4k recipients clear in well under an hour

export type CreateBroadcastInput = {
  templateCode: string;
  templateLanguage?: string;
  audienceKey: AudienceKey;
  selectedUserIds?: string[];
  triggeredByUserId?: string | null;
};

export type CreateBroadcastResult = { broadcastId: string; total: number; free: number; paid: number; estCostUsd: number };

// Resolve the audience, create the broadcast row, and enqueue one recipient row per phone.
export async function createBroadcast(input: CreateBroadcastInput): Promise<CreateBroadcastResult | { error: string }> {
  const supabase = getSupabaseAdmin();

  // Validate the template exists & is approved before enqueuing anything.
  try {
    await resolveApprovedTemplate(input.templateCode);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Template not found" };
  }

  const preview = await previewAudience(input.audienceKey, input.selectedUserIds ?? []);
  if (preview.total === 0) return { error: "No recipients in the selected audience." };

  const { data: broadcast, error } = await supabase
    .from("template_broadcasts")
    .insert({
      template_code: input.templateCode,
      template_language: input.templateLanguage ?? "en_US",
      audience_key: input.audienceKey,
      triggered_by_user_id: input.triggeredByUserId ?? null,
      status: "running",
      total_recipients: preview.total,
      count_free: preview.in_window,
      count_paid: preview.out_window,
      count_excluded: 0,
      est_cost_usd: preview.est_cost_usd,
    })
    .select("id")
    .single();
  if (error || !broadcast) return { error: error?.message ?? "Failed to create broadcast" };

  // Enqueue recipients in chunks (Postgres insert payload limits).
  const rows = preview.recipients.map((r) => ({
    broadcast_id: broadcast.id,
    family_id: r.familyId,
    phone_e164: r.phone,
    was_in_window: r.inWindow,
    send_status: "queued" as const,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await supabase.from("template_broadcast_recipients").insert(rows.slice(i, i + 500));
    if (insErr) return { error: insErr.message };
  }

  return {
    broadcastId: broadcast.id,
    total: preview.total,
    free: preview.in_window,
    paid: preview.out_window,
    estCostUsd: preview.est_cost_usd,
  };
}

export type DrainResult = { processed: number; broadcastsTouched: number };

// Process up to `batchSize` queued recipients across running broadcasts. Called by the drain cron
// (and once inline after creation for immediacy). Idempotent and safe to run concurrently-ish: it
// claims rows by flipping them out of 'queued' as it sends.
export async function drainBroadcasts(batchSize = DEFAULT_BATCH_SIZE): Promise<DrainResult> {
  const supabase = getSupabaseAdmin();

  const { data: queued } = await supabase
    .from("template_broadcast_recipients")
    .select("id, broadcast_id, phone_e164, template_broadcasts!inner(template_code, template_language, status)")
    .eq("send_status", "queued")
    .eq("template_broadcasts.status", "running")
    .limit(batchSize);

  const rows = (queued ?? []) as unknown as {
    id: string;
    broadcast_id: string;
    phone_e164: string;
    template_broadcasts: { template_code: string; template_language: string; status: string };
  }[];

  if (rows.length === 0) {
    await finalizeCompletedBroadcasts();
    return { processed: 0, broadcastsTouched: 0 };
  }

  // Resolve each distinct template once for this batch.
  const descriptors = new Map<string, Awaited<ReturnType<typeof resolveApprovedTemplate>> | null>();
  const touched = new Set<string>();
  let processed = 0;

  for (const row of rows) {
    touched.add(row.broadcast_id);
    const code = row.template_broadcasts.template_code;
    if (!descriptors.has(code)) {
      descriptors.set(code, await resolveApprovedTemplate(code).catch(() => null));
    }
    const desc = descriptors.get(code) ?? undefined;

    const result = await sendTemplateNotification({
      phoneE164: row.phone_e164,
      templateName: code,
      bodyParams: [],
      source: "template_broadcast",
      rawPayloadExtra: { broadcast_id: row.broadcast_id, recipient_id: row.id },
      descriptor: desc,
    });

    if (result.status === "sent") {
      await supabase
        .from("template_broadcast_recipients")
        .update({ send_status: "sent", wa_message_id: result.waMessageId ?? null, sent_at: new Date().toISOString() })
        .eq("id", row.id);
      await bumpCounter(row.broadcast_id, "count_sent");
    } else {
      await supabase
        .from("template_broadcast_recipients")
        .update({ send_status: "failed", error_detail: result.error ?? "send failed" })
        .eq("id", row.id);
      await bumpCounter(row.broadcast_id, "count_failed");
    }
    processed++;
  }

  await finalizeCompletedBroadcasts();
  return { processed, broadcastsTouched: touched.size };
}

// Increment a broadcast counter without an RPC (read-modify-write; fine at this scale/cadence).
async function bumpCounter(broadcastId: string, field: "count_sent" | "count_failed") {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("template_broadcasts").select(field).eq("id", broadcastId).single();
  const current = (data as Record<string, number> | null)?.[field] ?? 0;
  await supabase.from("template_broadcasts").update({ [field]: current + 1 }).eq("id", broadcastId);
}

// Mark broadcasts with no remaining queued recipients as completed.
async function finalizeCompletedBroadcasts() {
  const supabase = getSupabaseAdmin();
  const { data: running } = await supabase.from("template_broadcasts").select("id").eq("status", "running");
  for (const b of (running ?? []) as { id: string }[]) {
    const { count } = await supabase
      .from("template_broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id)
      .eq("send_status", "queued");
    if ((count ?? 0) === 0) {
      await supabase.from("template_broadcasts").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", b.id);
    }
  }
}

export { DEFAULT_BATCH_SIZE, utilityMessageCostUsd };
