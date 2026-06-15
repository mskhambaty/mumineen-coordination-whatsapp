import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

import { runAgent } from "@/lib/agent/run-agent";
import { answerImageQuestion } from "@/lib/agent/vision";
import { resolveCallerFromPhone } from "@/lib/api/auth";
import { getRegistrationStatus, isRegistrationGateEnabled } from "@/lib/mumineen/registration";
import { optionalEnv } from "@/lib/env";
import { fetchWhatsAppMedia, sendWhatsAppText, verifyMetaSignature } from "@/lib/meta/whatsapp";
import { getAccountByPhoneNumberId, getAccounts, type WhatsAppAccount } from "@/lib/whatsapp/accounts";
import {
  getSupabaseAdmin,
  getOrCreateWhatsappUser,
  recordInboundMessage,
  recordOutboundMessage,
  touchConversationSession,
} from "@/lib/supabase/server";
import { insertPendingMessage, runCoalescedInbound } from "@/lib/whatsapp/coalesce";
import { extractIncomingMessages, type IncomingWhatsAppMessage } from "@/lib/whatsapp/parser";
import { applyBroadcastStatuses, extractStatusUpdates, markBroadcastReplied } from "@/lib/whatsapp/broadcast-status";
import { recordInteractiveResponse } from "@/lib/whatsapp/interactive-responses";
import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { recordFamilyHeadCount, recordNiyazButtonResponse, recordUnregisteredRsvp, recordUnregisteredHeadCount, scopeToEntries, type ClampNotice, type NiyazLevel, type NiyazScope } from "@/lib/rsvp/meal-rsvp";
import { consumePrompt, createPrompt, findOpenPrompt } from "@/lib/rsvp/niyaz-prompt";

// Shared inbound-webhook logic for the Meta WhatsApp Cloud API. A SINGLE callback URL serves every
// WhatsApp account: each Meta App points at the same `/api/whatsapp/webhook`, and the account is
// resolved per delivery from the payload's metadata.phone_number_id. The account supplies the
// credentials used to verify the inbound signature and — critically — to send the reply *from the
// same number the message arrived on*. Handling is identical across accounts. Adding another number
// is env-only: configure its account and point its Meta App at this same URL — no new route.

// GET handshake: Meta verifies a callback URL by echoing hub.challenge when hub.verify_token matches.
// Because all accounts share this URL, accept the token if it matches ANY configured account's
// verify token (each Meta App sends its own during "Verify and Save").
export function webhookVerify(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const tokenMatches = Boolean(token) && getAccounts().some((a) => a.verifyToken && a.verifyToken === token);
  if (mode === "subscribe" && challenge && tokenMatches) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// POST handler: resolve which account this delivery is for (from metadata.phone_number_id), verify
// the signature with that account's app secret, then process messages and delivery-status callbacks.
// Replies are sent from the resolved account so they echo the receiving number.
export async function webhookReceive(req: NextRequest) {
  const rawBody = await req.text();

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Meta delivers a payload per WABA, so metadata.phone_number_id identifies the account (and Meta
  // App). Resolve it FIRST so we verify with the right app secret and reply from the right number.
  // This id only SELECTS the secret; the HMAC check below still authenticates the body, so reading
  // it from the not-yet-verified payload is safe.
  const businessPhoneNumberId = extractBusinessPhoneNumberId(payload);
  const account = businessPhoneNumberId ? getAccountByPhoneNumberId(businessPhoneNumberId) : undefined;
  if (!account) {
    // Delivery for a number we don't serve (or not configured yet). Ack 200 so Meta doesn't retry.
    return NextResponse.json({ received: true, processed: 0, ignored: "unknown_business_phone" });
  }

  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), account)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Delivery-status callbacks (sent/delivered/read/failed) ride the same webhook as messages and
  // carry no message body. Apply them to broadcast recipients, best-effort, before the message path.
  const statusUpdates = extractStatusUpdates(payload);
  if (statusUpdates.length > 0) {
    await applyBroadcastStatuses(statusUpdates).catch((err) => console.error("Broadcast status update failed:", err));
  }

  const messages = extractIncomingMessages(payload);

  if (messages.length === 0) {
    return NextResponse.json({ received: true, processed: 0, statuses: statusUpdates.length });
  }

  let processed = 0;

  for (const message of messages) {
    try {
      // If this number was recently broadcast to, mark that recipient as replied (best-effort).
      void markBroadcastReplied(message.phoneE164).catch(() => undefined);
      const didProcess = await processIncomingMessage(message, account);
      processed += didProcess ? 1 : 0;
    } catch (error) {
      console.error("Failed to process WhatsApp webhook message", {
        whatsappMessageId: message.whatsappMessageId,
        error,
      });
    }
  }

  return NextResponse.json({ received: true, processed });
}

async function processIncomingMessage(message: IncomingWhatsAppMessage, account: WhatsAppAccount) {
  if (!isAllowedBusinessPhone(message, account)) {
    console.log("Ignoring WhatsApp webhook message for non-matching business phone number", {
      account: account.label,
      businessPhoneNumberId: message.businessPhoneNumberId,
      businessDisplayPhoneNumber: message.businessDisplayPhoneNumber,
      whatsappMessageId: message.whatsappMessageId,
    });
    return false;
  }

  const inbound = await recordInboundMessage(message);

  if (!inbound.inserted) {
    return false;
  }

  const user = await getOrCreateWhatsappUser(message.phoneE164, message.profileName);

  await touchConversationSession({
    phoneE164: message.phoneE164,
    userId: user.id,
  });

  if (message.messageType === "reaction") {
    return true;
  }

  // Double-RSVP interactive responses (ashara_relay_double_rsvp): a Flow completion (nfm_reply) or
  // the "not-attending-…" quick-reply. Phase 1 captures the raw response for later decoding and
  // stops — these are NOT routed to the agent and NOT yet recorded as RSVPs (phase 2).
  if (message.flowResponse) {
    await recordInteractiveResponse({
      phoneE164: message.phoneE164,
      waMessageId: message.whatsappMessageId,
      type: "flow",
      flowToken: message.flowResponse.flowToken,
      payload: message.flowResponse.responseJson,
    });
    return true;
  }
  if (message.buttonPayload && message.buttonPayload.startsWith("not-attending-")) {
    await recordInteractiveResponse({
      phoneE164: message.phoneE164,
      waMessageId: message.whatsappMessageId,
      type: "button",
      flowToken: message.buttonPayload,
      payload: { payload: message.buttonPayload },
    });
    return true;
  }

  // Niyaz daily-template button taps: record the RSVP directly and confirm, skipping the agent.
  // Handled before manual-mode / registration gates since it's a deterministic data capture from a
  // message we sent (the payload carries level|scope|date; the phone identifies the responder).
  if (message.buttonPayload && message.buttonPayload.startsWith("niyaz|")) {
    await handleNiyazButton(message, user.id, account);
    return true;
  }

  // Free-text family head-count reply: if there's an open RSVP prompt for this number and the message
  // contains a number, record the family head count for that prompt's date and confirm.
  if (message.body.trim() && /\d/.test(message.body) && (await handleNiyazHeadCount(message, user.id, account))) {
    return true;
  }

  const { data: session } = await getSupabaseAdmin()
    .from("conversation_sessions")
    .select("handling_mode")
    .eq("phone_e164", message.phoneE164)
    .maybeSingle();

  if (session?.handling_mode === "manual") {
    return true;
  }

  // Registration gate (off by default): unregistered, non-internal users get a nudge to
  // register instead of agent service. Internal users (committee/admin/support) bypass.
  if (await isRegistrationGateEnabled()) {
    const { registered } = await getRegistrationStatus(message.phoneE164);
    if (!registered) {
      const internal = await resolveCallerFromPhone(message.phoneE164).then(() => true).catch(() => false);
      if (!internal) {
        await sendRegistrationNudge(message.phoneE164, user.id, account);
        return true;
      }
    }
  }

  if (message.media) {
    await replyToImage(message, user.id, account);
    return true;
  }

  if (!message.body.trim()) {
    return true;
  }

  // Queue the text message for coalesced processing instead of responding immediately.
  const lockKey = message.phoneE164;

  await insertPendingMessage({
    lockKey,
    phoneE164: message.phoneE164,
    messageId: message.whatsappMessageId,
    body: message.body,
    inboundMsgId: inbound.id,
  });

  after(() =>
    runCoalescedInbound<string>({
      lockKey,
      process: async (combinedText) => {
        return runAgent({
          user,
          phoneE164: message.phoneE164,
          message: combinedText,
        });
      },
      send: async (reply) => {
        const cleaned = reply.replace(/\[\[\s*no[_\s]?reply\s*\]\]/gi, "").trim();
        if (isSilentReply(cleaned)) {
          return;
        }

        const metaResponse = await sendWhatsAppText(message.phoneE164, cleaned, account);
        const outboundId = metaResponse.messages?.[0]?.id;

        await recordOutboundMessage({
          phoneE164: message.phoneE164,
          body: cleaned,
          whatsappMessageId: outboundId,
          rawPayload: metaResponse,
        });

        await touchConversationSession({
          phoneE164: message.phoneE164,
          userId: user.id,
        });
      },
    }),
  );

  return true;
}

const NIYAZ_LEVELS: NiyazLevel[] = ["ind", "fam"];
const NIYAZ_SCOPES: NiyazScope[] = ["both", "lunch", "dinner", "none"];

// Record a Niyaz daily-template button tap and confirm. Payload: niyaz|<level>|<scope>|<YYYY-MM-DD>.
// The phone identifies the responder's family/mumin (resolveFamilyForPhone).
async function handleNiyazButton(message: IncomingWhatsAppMessage, userId: string | undefined, account: WhatsAppAccount) {
  const parts = (message.buttonPayload ?? "").split("|");
  const [, level, scope, date] = parts;
  const valid =
    parts.length === 4 &&
    NIYAZ_LEVELS.includes(level as NiyazLevel) &&
    NIYAZ_SCOPES.includes(scope as NiyazScope) &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);

  let reply: string;
  if (!valid) {
    reply = "Shukran for your reply. We couldn't read that response — please try the buttons again.";
  } else {
    const family = await resolveFamilyForPhone(message.phoneE164);
    if (family) {
      await recordNiyazButtonResponse({
        level: level as NiyazLevel,
        scope: scope as NiyazScope,
        date,
        muminId: family.muminId,
        familyId: family.familyId,
        phone: message.phoneE164,
      });
      reply = niyazConfirmation(level as NiyazLevel, scope as NiyazScope, date);
    } else {
      await recordUnregisteredRsvp({ phone: message.phoneE164, entries: scopeToEntries(scope as NiyazScope, date) });
      await createPrompt({ phone: message.phoneE164, familyId: null, eventDate: date });
      const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      reply = `Shukran for your reply! We've recorded your response for ${day}. This number isn't linked to a registered family yet — please reply with the number of people attending (e.g. '5') and we'll update your count.\n\nPlease also register your family at ${REGISTER_URL} so we can match your records.`;
    }
  }

  const metaResponse = await sendWhatsAppText(message.phoneE164, reply, account);
  await recordOutboundMessage({
    phoneE164: message.phoneE164,
    body: reply,
    whatsappMessageId: metaResponse.messages?.[0]?.id,
    rawPayload: { source: "niyaz_rsvp_button", payload: message.buttonPayload, meta_response: metaResponse },
  });
  await touchConversationSession({ phoneE164: message.phoneE164, userId });
}

// Record a free-text head-count reply against the caller's most recent open prompt. Returns false
// (so the message flows to the agent) when there's no open prompt or no number in the message.
async function handleNiyazHeadCount(message: IncomingWhatsAppMessage, userId: string | undefined, account: WhatsAppAccount): Promise<boolean> {
  const prompt = await findOpenPrompt(message.phoneE164);
  if (!prompt) return false;
  const m = message.body.match(/\d{1,3}/);
  if (!m) return false;
  const count = Math.min(999, parseInt(m[0], 10));

  const isUnregistered = !prompt.family_id;
  let clamped: ClampNotice | undefined;
  if (prompt.family_id) {
    // Head count is materialized into niyaz_rsvp (allocated across family members). If it exceeds
    // the family's roster, the result is clamped to the actual member count.
    const result = await recordFamilyHeadCount(prompt.family_id, prompt.event_date, count, message.phoneE164);
    clamped = result.clamped;
  } else {
    await recordUnregisteredHeadCount(message.phoneE164, prompt.event_date, count);
  }
  await consumePrompt(prompt.id);

  const day = new Date(`${prompt.event_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const recorded = clamped ? clamped.maxTotal : count;
  let reply = `Shukran! Recorded ${recorded} from your family attending for ${day}. Reply with a new number if it changes.`;
  if (clamped) {
    reply += `\n\nThat's more than your registered family size, so we recorded ${clamped.maxTotal}. Anyone extra should message us from their own phone and register at ${REGISTER_URL}.`;
  }
  if (isUnregistered) {
    reply += `\n\nPlease register your family at ${REGISTER_URL} so we can link your records automatically.`;
  }
  const metaResponse = await sendWhatsAppText(message.phoneE164, reply, account);
  await recordOutboundMessage({
    phoneE164: message.phoneE164,
    body: reply,
    whatsappMessageId: metaResponse.messages?.[0]?.id,
    rawPayload: { source: "niyaz_rsvp_headcount", event_date: prompt.event_date, head_count: count, meta_response: metaResponse },
  });
  await touchConversationSession({ phoneE164: message.phoneE164, userId });
  return true;
}

function niyazConfirmation(level: NiyazLevel, scope: NiyazScope, date: string): string {
  const who = level === "fam" ? "your family" : "you";
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const scopeText: Record<NiyazScope, string> = {
    both: `${who} attending lunch & dinner`,
    lunch: `${who} attending lunch only`,
    dinner: `${who} attending dinner only`,
    none: `${who} not attending`,
  };
  return `Shukran! Recorded: ${scopeText[scope]} for ${day}. Reply here if it changes.`;
}

function isSilentReply(reply: string): boolean {
  const trimmed = reply.trim();
  if (!trimmed) return true;
  return trimmed.replace(/[^a-z]/gi, "").toUpperCase() === "NOREPLY";
}

const REGISTER_URL = "https://www.chicagorelaycenter.com/register";

// Tell an unregistered visitor to register, and record it. Best-effort.
async function sendRegistrationNudge(phone: string, userId: string | undefined, account: WhatsAppAccount) {
  const reply =
    "Salaam. This number isn't registered for Ashara Mubaraka 1448H (Chicago) yet, so I can't assist over chat. " +
    `Please complete your family's registration here: ${REGISTER_URL} — then message us again and we'll be glad to help.`;
  const metaResponse = await sendWhatsAppText(phone, reply, account);
  await recordOutboundMessage({
    phoneE164: phone,
    body: reply,
    whatsappMessageId: metaResponse.messages?.[0]?.id,
    rawPayload: { source: "registration_gate", meta_response: metaResponse },
  });
  await touchConversationSession({ phoneE164: phone, userId });
}

async function replyToImage(message: IncomingWhatsAppMessage, userId: string | undefined, account: WhatsAppAccount) {
  const media = message.media;
  if (!media) return;

  let answer: string;
  try {
    const { buffer, mimeType } = await fetchWhatsAppMedia(media.id, account);
    answer = await answerImageQuestion({
      buffer,
      mimeType: media.mimeType ?? mimeType,
      question: media.caption,
    });
    if (!answer) throw new Error("Vision returned an empty answer");
  } catch (error) {
    console.error("Failed to read inbound image", error);
    answer = "I had trouble reading that image — could you resend it, or tell me what you need help with?";
  }

  const metaResponse = await sendWhatsAppText(message.phoneE164, answer, account);
  await recordOutboundMessage({
    phoneE164: message.phoneE164,
    body: answer,
    whatsappMessageId: metaResponse.messages?.[0]?.id,
    rawPayload: metaResponse,
  });
  await touchConversationSession({ phoneE164: message.phoneE164, userId });
}

// Accept a message only if it was delivered to the number this route serves: match the account's
// phone-number-id (falling back to its display number when the id isn't in the payload). A legacy
// explicit allow-list (WHATSAPP_ALLOWED_PHONE_NUMBER_IDS) is still honored for backwards compat.
function isAllowedBusinessPhone(message: IncomingWhatsAppMessage, account: WhatsAppAccount) {
  const id = message.businessPhoneNumberId;
  if (id) {
    if (id === account.phoneNumberId) {
      return true;
    }
    const legacy = (optionalEnv("WHATSAPP_ALLOWED_PHONE_NUMBER_IDS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return legacy.includes(id);
  }

  if (account.displayNumber) {
    return normalizePhoneDigits(message.businessDisplayPhoneNumber ?? "") === normalizePhoneDigits(account.displayNumber);
  }

  // No identifying metadata to filter on — accept (matches the prior lenient default).
  return true;
}

function normalizePhoneDigits(phone: string) {
  return phone.replace(/[^\d]/g, "");
}

// The business phone-number-id a webhook delivery is addressed to, read from the first
// entry[].changes[].value.metadata.phone_number_id. Used to route the delivery to the right account
// on the shared callback URL. Returns null when the payload carries no such metadata.
function extractBusinessPhoneNumberId(payload: unknown): string | null {
  const root = payload as {
    entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: unknown } } }> }>;
  };
  for (const entry of root?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const id = change?.value?.metadata?.phone_number_id;
      if (typeof id === "string" && id) {
        return id;
      }
    }
  }
  return null;
}
