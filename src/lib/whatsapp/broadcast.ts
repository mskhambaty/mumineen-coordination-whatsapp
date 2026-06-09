import { previewAudience, utilityMessageCostUsd, type AudienceKey } from "@/lib/whatsapp/audience";
import type { RuleGroup } from "@/lib/whatsapp/audience-filter";
import { resolveApprovedTemplate, sendTemplateNotification } from "@/lib/whatsapp/send-template";
import { resolveBindings, type SendComponentInputs, type VariableBindings } from "@/lib/whatsapp/templates";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Broadcast engine for the template-send console. A broadcast is created with all its recipients
// enqueued ('queued'), then drained in throttled batches by a cron so the work survives serverless
// time limits and naturally rate-limits the fan-out. All sends go through the shared
// sendTemplateNotification pipeline (logging, no PII leakage). Templates may have variables: each is
// bound to a static value or a per-recipient roster field; recipients whose mapped field is empty
// (or who have no roster fields) are recorded 'skipped'. Per-recipient resolved params are frozen
// onto the recipient row at create time.

const DEFAULT_BATCH_SIZE = 150; // per drain invocation; ~4k recipients clear in well under an hour

export type CreateBroadcastInput = {
  templateCode: string;
  templateLanguage?: string;
  audienceKey: AudienceKey;
  selectedUserIds?: string[];
  rules?: RuleGroup; // for the "custom" audience
  variableBindings?: VariableBindings;
  triggeredByUserId?: string | null;
};

export type CreateBroadcastResult = { broadcastId: string; total: number; free: number; paid: number; skipped: number; estCostUsd: number };

// Resolve the audience, create the broadcast row, freeze per-recipient template params, and enqueue
// one recipient row per phone.
export async function createBroadcast(input: CreateBroadcastInput): Promise<CreateBroadcastResult | { error: string }> {
  const supabase = getSupabaseAdmin();

  // Validate the template exists & is approved before enqueuing anything.
  let desc;
  try {
    desc = await resolveApprovedTemplate(input.templateCode);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Template not found" };
  }

  // Every template variable must have a binding.
  const bindings: VariableBindings = input.variableBindings ?? {};
  for (const tok of desc.bodyVars) {
    if (!bindings.body?.[tok]) return { error: `Missing binding for variable "${tok}".` };
  }
  if (desc.header?.format === "TEXT" && desc.headerVar && !bindings.header) {
    return { error: `Missing binding for header variable "${desc.headerVar}".` };
  }
  if (desc.header && desc.header.format !== "TEXT" && !bindings.headerMediaUrl) {
    return { error: "This template has a media header — provide a media URL." };
  }
  if (desc.urlButtons.some((b) => b.hasVar) && !bindings.urlButton) {
    return { error: "Missing binding for the URL button value." };
  }

  const preview = await previewAudience(input.audienceKey, input.selectedUserIds ?? [], input.rules);
  if (preview.total === 0) return { error: "No recipients in the selected audience." };

  // Resolve each recipient's params now; recipients missing a mapped field are marked skipped.
  type Row = { family_id: string | null; phone_e164: string; was_in_window: boolean; send_status: "queued" | "skipped"; skip_reason: string | null; body_params: SendComponentInputs | null };
  const prelim: Row[] = [];
  let skipped = 0, free = 0, paid = 0;
  for (const r of preview.recipients) {
    const { inputs, skipReason } = resolveBindings(desc, bindings, r.fields ?? {});
    if (skipReason) {
      skipped += 1;
      prelim.push({ family_id: r.familyId, phone_e164: r.phone, was_in_window: r.inWindow, send_status: "skipped", skip_reason: skipReason, body_params: null });
    } else {
      if (r.inWindow) free += 1; else paid += 1;
      prelim.push({ family_id: r.familyId, phone_e164: r.phone, was_in_window: r.inWindow, send_status: "queued", skip_reason: null, body_params: inputs });
    }
  }
  const estCostUsd = Number((paid * utilityMessageCostUsd()).toFixed(2));

  const { data: broadcast, error } = await supabase
    .from("template_broadcasts")
    .insert({
      template_code: input.templateCode,
      template_language: input.templateLanguage ?? desc.language ?? "en_US",
      audience_key: input.audienceKey,
      audience_rules: input.rules ?? null,
      variable_bindings: input.variableBindings ?? null,
      triggered_by_user_id: input.triggeredByUserId ?? null,
      status: "running",
      total_recipients: preview.total,
      count_free: free,
      count_paid: paid,
      count_excluded: 0,
      count_skipped: skipped,
      est_cost_usd: estCostUsd,
    })
    .select("id")
    .single();
  if (error || !broadcast) return { error: error?.message ?? "Failed to create broadcast" };

  // Enqueue recipients in chunks (Postgres insert payload limits).
  const rows = prelim.map((r) => ({ ...r, broadcast_id: broadcast.id }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await supabase.from("template_broadcast_recipients").insert(rows.slice(i, i + 500));
    if (insErr) return { error: insErr.message };
  }

  return { broadcastId: broadcast.id, total: preview.total, free, paid, skipped, estCostUsd };
}

export type DrainResult = { processed: number; broadcastsTouched: number };

// Process up to `batchSize` pending recipients across running broadcasts. Called by the drain cron
// (and once inline after creation for immediacy). Safe to run concurrently: it claims a batch
// atomically (flipping rows 'queued' -> 'sending' under FOR UPDATE SKIP LOCKED) BEFORE sending, so
// two overlapping drains can never grab the same recipient and double-send. Rows stuck in 'sending'
// from a drain that died mid-batch are reclaimed by the RPC after a stale window.
export async function drainBroadcasts(batchSize = DEFAULT_BATCH_SIZE): Promise<DrainResult> {
  const supabase = getSupabaseAdmin();

  const { data: claimed, error: claimErr } = await supabase.rpc("claim_broadcast_recipients", {
    p_batch_size: batchSize,
  });
  if (claimErr) throw new Error(`Failed to claim broadcast recipients: ${claimErr.message}`);

  const rows = (claimed ?? []) as {
    id: string;
    broadcast_id: string;
    phone_e164: string;
    body_params: SendComponentInputs | null;
    template_code: string;
    template_language: string;
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
    const code = row.template_code;
    if (!descriptors.has(code)) {
      descriptors.set(code, await resolveApprovedTemplate(code).catch(() => null));
    }
    const desc = descriptors.get(code) ?? undefined;

    const result = await sendTemplateNotification({
      phoneE164: row.phone_e164,
      templateName: code,
      bodyParams: row.body_params?.bodyParams ?? [],
      inputs: row.body_params ?? undefined,
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

// Atomically increment a broadcast counter (UPDATE col = col + 1 in the DB). Must not be a JS
// read-modify-write: concurrent drains bumping the same broadcast would lose increments.
async function bumpCounter(broadcastId: string, field: "count_sent" | "count_failed") {
  const { error } = await getSupabaseAdmin().rpc("bump_broadcast_counter", {
    p_broadcast_id: broadcastId,
    p_field: field,
  });
  if (error) console.error("Failed to bump broadcast counter:", field, error.message);
}

// Mark broadcasts with no remaining pending recipients as completed. 'sending' counts as pending —
// a broadcast isn't done until every claimed recipient has settled (sent/failed).
async function finalizeCompletedBroadcasts() {
  const supabase = getSupabaseAdmin();
  const { data: running } = await supabase.from("template_broadcasts").select("id").eq("status", "running");
  for (const b of (running ?? []) as { id: string }[]) {
    const { count } = await supabase
      .from("template_broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id)
      .in("send_status", ["queued", "sending"]);
    if ((count ?? 0) === 0) {
      await supabase.from("template_broadcasts").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", b.id);
    }
  }
}

export { DEFAULT_BATCH_SIZE, utilityMessageCostUsd };
