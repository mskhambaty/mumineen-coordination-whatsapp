import { NextRequest, NextResponse } from "next/server";

import { handleInboundText, REGISTER_URL } from "@/lib/agent/text-turn";
import { answerImageQuestion } from "@/lib/agent/vision";
import { optionalEnv } from "@/lib/env";
import { fetchWhatsAppMedia, sendWhatsAppText, verifyMetaSignature } from "@/lib/meta/whatsapp";
import { getAccountByPhoneNumberId, getAccounts, type WhatsAppAccount } from "@/lib/whatsapp/accounts";
import {
  getOrCreateWhatsappUser,
  recordInboundMessage,
  recordOutboundMessage,
  touchConversationSession,
} from "@/lib/supabase/server";
import { extractIncomingMessages, type IncomingWhatsAppMessage } from "@/lib/whatsapp/parser";
import { applyBroadcastStatuses, extractStatusUpdates, markBroadcastReplied } from "@/lib/whatsapp/broadcast-status";
import { recordInteractiveResponse } from "@/lib/whatsapp/interactive-responses";
import { parseCount, parseRsvpToken, recordNiyazRsvpFromInteractive } from "@/lib/rsvp/niyaz-interactive";
import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { recordNiyazButtonResponse, recordUnregisteredRsvp, scopeToEntries, type NiyazLevel, type NiyazScope } from "@/lib/rsvp/meal-rsvp";
import { createPrompt } from "@/lib/rsvp/niyaz-prompt";

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
    phoneNumberId: account.phoneNumberId,
  });

  if (message.messageType === "reaction") {
    return true;
  }

  // Double-RSVP interactive responses (ashara_relay_double_rsvp): a Flow completion (nfm_reply) or
  // the "rsvp:…:not-attending" quick-reply. Phase 1 captures the raw response for later decoding and
  // stops — these are NOT routed to the agent and NOT yet recorded as RSVPs (phase 2).
  if (message.flowResponse) {
    await recordInteractiveResponse({
      phoneE164: message.phoneE164,
      waMessageId: message.whatsappMessageId,
      type: "flow",
      flowToken: message.flowResponse.flowToken,
      payload: message.flowResponse.responseJson,
    });
    // Phase 2: decode the Flow's collected data into niyaz_rsvp (best-effort; raw row already saved).
    try {
      const rj = message.flowResponse.responseJson as Record<string, unknown> | null;
      if (rj && typeof rj === "object") {
        // Family + day come from the flow_token (rsvp:<hof>:<day>) — always present and under our
        // control — falling back to the Flow body. The single-meal Flow returns one attending_count;
        // the double Flow returns separate lunch/dinner counts.
        const tok = parseRsvpToken(message.flowResponse.flowToken);
        const hofIts = String(rj.hof_its ?? tok.hofIts ?? "");
        const dayId = Number(rj.registration_instance_id ?? tok.dayId);
        const isSingle = rj.attending_count !== undefined && rj.attending_count !== null;
        const outcome = await recordNiyazRsvpFromInteractive({
          hofIts,
          dayId,
          phone: message.phoneE164,
          ...(isSingle
            ? { attendingCount: parseCount(rj.attending_count) }
            : { lunchCount: parseCount(rj.lunch_attending_count), dinnerCount: parseCount(rj.dinner_attending_count) }),
        });
        if (outcome.status === "ended" && outcome.endedMessage) await sendNiyazRsvpEnded(message, outcome.endedMessage, account);
      }
    } catch (err) {
      console.error("Niyaz flow RSVP decode failed", { inboundId: inbound.id, err });
    }
    return true;
  }
  if (message.buttonPayload && message.buttonPayload.startsWith("rsvp:")) {
    await recordInteractiveResponse({
      phoneE164: message.phoneE164,
      waMessageId: message.whatsappMessageId,
      type: "button",
      flowToken: message.buttonPayload,
      payload: { payload: message.buttonPayload },
    });
    // "rsvp:<hof_its>:<day_id>:not-attending" → record both meals as not attending (counts 0/0).
    try {
      const parts = message.buttonPayload.split(":");
      if (parts.length >= 4 && parts[3] === "not-attending") {
        const outcome = await recordNiyazRsvpFromInteractive({ hofIts: parts[1], dayId: Number(parts[2]), lunchCount: 0, dinnerCount: 0, phone: message.phoneE164 });
        if (outcome.status === "ended" && outcome.endedMessage) await sendNiyazRsvpEnded(message, outcome.endedMessage, account);
      }
    } catch (err) {
      console.error("Niyaz button RSVP decode failed", { inboundId: inbound.id, err });
    }
    return true;
  }

  // Niyaz daily-template button taps: record the RSVP directly and confirm, skipping the agent.
  // Handled before manual-mode / registration gates since it's a deterministic data capture from a
  // message we sent (the payload carries level|scope|date; the phone identifies the responder).
  if (message.buttonPayload && message.buttonPayload.startsWith("niyaz|")) {
    await handleNiyazButton(message, user.id, account);
    return true;
  }

  // Everything else (head-count reply, manual mode, registration gate, coalesced agent run) is the
  // channel-neutral text pipeline shared with the in-app chat. Images skip the agent for vision.
  await handleInboundText({
    user,
    phoneE164: message.phoneE164,
    body: message.body,
    messageId: message.whatsappMessageId,
    inboundId: inbound.id,
    deliver: (text, extra) => deliverWhatsApp(message.phoneE164, text, user.id, account, extra),
    replyInsteadOfAgent: message.media ? () => replyToImage(message, user.id, account) : undefined,
  });

  return true;
}

// WhatsApp reply delivery: send from the receiving account, record, and touch the session.
async function deliverWhatsApp(
  phone: string,
  text: string,
  userId: string | undefined,
  account: WhatsAppAccount,
  extra?: Record<string, unknown>,
) {
  const metaResponse = await sendWhatsAppText(phone, text, account);
  await recordOutboundMessage({
    phoneE164: phone,
    body: text,
    whatsappMessageId: metaResponse.messages?.[0]?.id,
    rawPayload: extra ? { ...extra, meta_response: metaResponse } : metaResponse,
    phoneNumberId: account.phoneNumberId,
  });
  await touchConversationSession({ phoneE164: phone, userId, phoneNumberId: account.phoneNumberId });
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
    phoneNumberId: account.phoneNumberId,
  });
  await touchConversationSession({ phoneE164: message.phoneE164, userId, phoneNumberId: account.phoneNumberId });
}

// Reply when an interactive RSVP arrives after the day's cutoff: tell the responder it's closed and
// record/attribute the outbound to the niyaz number (so it stays in the niyaz inbox).
async function sendNiyazRsvpEnded(message: IncomingWhatsAppMessage, text: string, account: WhatsAppAccount) {
  const metaResponse = await sendWhatsAppText(message.phoneE164, text, account);
  await recordOutboundMessage({
    phoneE164: message.phoneE164,
    body: text,
    whatsappMessageId: metaResponse.messages?.[0]?.id,
    rawPayload: { source: "niyaz_rsvp_ended", meta_response: metaResponse },
    phoneNumberId: account.phoneNumberId,
  });
  await touchConversationSession({ phoneE164: message.phoneE164, phoneNumberId: account.phoneNumberId });
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
    phoneNumberId: account.phoneNumberId,
  });
  await touchConversationSession({ phoneE164: message.phoneE164, userId, phoneNumberId: account.phoneNumberId });
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
