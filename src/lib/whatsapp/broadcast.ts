import { getInWindowPhones, normalizePhone, previewAudience, utilityMessageCostUsd, type AudienceKey, type Recipient, type WindowFilter } from "@/lib/whatsapp/audience";
import type { RuleGroup } from "@/lib/whatsapp/audience-filter";
import { resolveApprovedTemplate, sendTemplateNotification } from "@/lib/whatsapp/send-template";
import { suppressedPhones } from "@/lib/whatsapp/undeliverable";
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
  audienceKey?: AudienceKey; // omit when passing an explicit `recipients` list
  selectedUserIds?: string[];
  rules?: RuleGroup; // for the "custom" audience
  // Restrict the audience to one side of the 24h window (free in-window vs paid out-of-window).
  // Defaults to "all".
  windowFilter?: WindowFilter;
  // Override the free-window size (hours) used to classify recipients as in/out of window.
  // Defaults to the env-configured WHATSAPP_WINDOW_HOURS.
  windowHours?: number;
  variableBindings?: VariableBindings;
  triggeredByUserId?: string | null;
  // Explicit recipient list (e.g. the Niyaz RSVP send). When provided, audience resolution is
  // skipped and these are used directly. `audienceKey` is then just the label stored on the row.
  recipients?: Recipient[];
  // Per-send quick-reply button payloads, frozen onto every recipient (e.g. RSVP buttons).
  quickReplyButtons?: { index: number; payload: string }[];
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

  // Recipients: an explicit list (Niyaz RSVP send) or a resolved audience. Both carry an inWindow flag.
  const windowFilter: WindowFilter = input.windowFilter ?? "all";
  let recipients: (Recipient & { inWindow: boolean })[];
  if (input.recipients) {
    const [inWindow, suppressed] = await Promise.all([getInWindowPhones(input.windowHours), suppressedPhones()]);
    // Drop numbers Meta flagged as undeliverable so explicit-list sends (Niyaz RSVP, CSV upload)
    // skip them too — the audience-path recipients are already filtered by previewAudience below.
    recipients = input.recipients
      .filter((r) => !suppressed.has(normalizePhone(r.phone)))
      .map((r) => ({ ...r, inWindow: inWindow.has(r.phone) }));
    // Apply the window filter to explicit lists too. Niyaz callers omit windowFilter, so this is a
    // no-op for them.
    if (windowFilter === "in_window") recipients = recipients.filter((r) => r.inWindow);
    else if (windowFilter === "out_window") recipients = recipients.filter((r) => !r.inWindow);
  } else {
    if (!input.audienceKey) return { error: "No audience specified." };
    const preview = await previewAudience(input.audienceKey, input.selectedUserIds ?? [], input.rules, windowFilter, input.windowHours);
    recipients = preview.recipients;
  }
  if (recipients.length === 0) return { error: "No recipients in the selected audience." };

  // Resolve each recipient's params now; recipients missing a mapped field are marked skipped.
  type Row = { family_id: string | null; phone_e164: string; was_in_window: boolean; send_status: "queued" | "skipped"; skip_reason: string | null; body_params: SendComponentInputs | null };
  const prelim: Row[] = [];
  let skipped = 0, free = 0, paid = 0;
  for (const r of recipients) {
    const { inputs, skipReason } = resolveBindings(desc, bindings, r.fields ?? {});
    if (skipReason) {
      skipped += 1;
      prelim.push({ family_id: r.familyId, phone_e164: r.phone, was_in_window: r.inWindow, send_status: "skipped", skip_reason: skipReason, body_params: null });
    } else {
      if (input.quickReplyButtons) inputs.quickReplyButtons = input.quickReplyButtons;
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
      audience_key: input.audienceKey ?? "niyaz_rsvp",
      audience_rules: input.rules ?? null,
      variable_bindings: input.variableBindings ?? null,
      triggered_by_user_id: input.triggeredByUserId ?? null,
      status: "running",
      total_recipients: recipients.length,
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

  return { broadcastId: broadcast.id, total: recipients.length, free, paid, skipped, estCostUsd };
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

export type DrainUntilEmptyResult = { processed: number; batches: number };

// Drain repeatedly until the queue is empty (a batch returns 0 processed) or a bound is hit. Used by
// the inline post-send kick and the manual "Send pending" trigger so completing a broadcast never
// depends solely on the minute cron. Bounded by BOTH a batch cap and a wall-clock deadline — never an
// unbounded loop (AGENTS.md guardrail). Each underlying drainBroadcasts() call still claims atomically,
// so this is safe to run concurrently with the cron.
export async function drainUntilEmpty(opts?: { maxBatches?: number; deadlineMs?: number; batchSize?: number }): Promise<DrainUntilEmptyResult> {
  const maxBatches = opts?.maxBatches ?? 20;
  const deadlineMs = opts?.deadlineMs ?? 50_000;
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const start = Date.now();
  let processed = 0;
  let batches = 0;
  while (batches < maxBatches && Date.now() - start < deadlineMs) {
    const { processed: n } = await drainBroadcasts(batchSize);
    batches += 1;
    processed += n;
    if (n === 0) break; // queue drained
  }
  return { processed, batches };
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
//
// createBroadcast inserts the broadcast row ('running') and its recipient rows in two separate
// writes. In the gap between them the broadcast has zero recipient rows, so a concurrent drain
// (the minute cron, or another send's inline drain) calling this would see "no pending recipients"
// and wrongly mark it completed — after which claim_broadcast_recipients (running-only) can never
// claim the rows, stranding every recipient as 'queued'. Guard against it: a broadcast with zero
// recipient rows isn't done, it's not populated yet, so skip it until its recipients exist.
async function finalizeCompletedBroadcasts() {
  const supabase = getSupabaseAdmin();
  const { data: running } = await supabase.from("template_broadcasts").select("id").eq("status", "running");
  for (const b of (running ?? []) as { id: string }[]) {
    const { count: total } = await supabase
      .from("template_broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id);
    if ((total ?? 0) === 0) continue; // recipients not enqueued yet — not finished, just unpopulated

    const { count: pending } = await supabase
      .from("template_broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id)
      .in("send_status", ["queued", "sending"]);
    if ((pending ?? 0) === 0) {
      await supabase.from("template_broadcasts").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", b.id);
    }
  }
}

// Human-readable bucket for a failed recipient, used by the console failure breakdown and CSV. Many
// delivery failures arrive from Meta's status webhook with no error_detail — bucket those by window.
export function categorizeFailure(errorDetail: string | null, wasInWindow: boolean | null): string {
  if (errorDetail && errorDetail.trim()) return errorDetail.trim();
  return wasInWindow === false ? "Delivery failed (outside 24h window)" : "Delivery failed";
}

export { DEFAULT_BATCH_SIZE, utilityMessageCostUsd };
