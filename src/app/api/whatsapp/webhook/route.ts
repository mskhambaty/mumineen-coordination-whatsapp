import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

import { runAgent } from "@/lib/agent/run-agent";
import { answerImageQuestion } from "@/lib/agent/vision";
import { resolveCallerFromPhone } from "@/lib/api/auth";
import { getRegistrationStatus, isRegistrationGateEnabled } from "@/lib/mumineen/registration";
import { optionalEnv } from "@/lib/env";
import { fetchWhatsAppMedia, sendWhatsAppText, verifyMetaSignature } from "@/lib/meta/whatsapp";
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
import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { recordFamilyHeadCount, recordNiyazButtonResponse, recordUnregisteredRsvp, recordUnregisteredHeadCount, type NiyazLevel, type NiyazScope } from "@/lib/rsvp/meal-rsvp";
import { consumePrompt, createPrompt, findOpenPrompt } from "@/lib/rsvp/niyaz-prompt";

export const runtime = "nodejs";
// The reply is generated in an after() background task that runs up to two sequential model
// completions. Reasoning models (GPT-5.x) are much slower than gpt-4o-mini, so without an
// explicit cap the background work was being killed by the default timeout before it could send
// — the webhook returned 200, no error was thrown, and the user got total silence. Match the
// generous cap used by the other heavy routes so the agent always has time to finish and reply.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === optionalEnv("META_WEBHOOK_VERIFY_TOKEN") && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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
      const didProcess = await processIncomingMessage(message);
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

async function processIncomingMessage(message: IncomingWhatsAppMessage) {
  if (!isAllowedBusinessPhone(message)) {
    console.log("Ignoring WhatsApp webhook message for non-Ashara phone number", {
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

  // Niyaz daily-template button taps: record the RSVP directly and confirm, skipping the agent.
  // Handled before manual-mode / registration gates since it's a deterministic data capture from a
  // message we sent (the payload carries level|scope|date; the phone identifies the responder).
  if (message.buttonPayload && message.buttonPayload.startsWith("niyaz|")) {
    await handleNiyazButton(message, user.id);
    return true;
  }

  // Free-text family head-count reply: if there's an open RSVP prompt for this number and the message
  // contains a number, record the family head count for that prompt's date and confirm.
  if (message.body.trim() && /\d/.test(message.body) && (await handleNiyazHeadCount(message, user.id))) {
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
        await sendRegistrationNudge(message.phoneE164, user.id);
        return true;
      }
    }
  }

  if (message.media) {
    await replyToImage(message, user.id);
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

        const metaResponse = await sendWhatsAppText(message.phoneE164, cleaned);
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
async function handleNiyazButton(message: IncomingWhatsAppMessage, userId: string | undefined) {
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
      await recordUnregisteredRsvp({ phone: message.phoneE164, date, scope: scope as NiyazScope });
      await createPrompt({ phone: message.phoneE164, familyId: null, eventDate: date });
      const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      reply = `Shukran for your reply! We've recorded your response for ${day}. This number isn't linked to a registered family yet — please reply with the number of people attending (e.g. '5') and we'll update your count.\n\nPlease also register your family at https://www.chicagorelaycenter.com/register so we can match your records.`;
    }
  }

  const metaResponse = await sendWhatsAppText(message.phoneE164, reply);
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
async function handleNiyazHeadCount(message: IncomingWhatsAppMessage, userId: string | undefined): Promise<boolean> {
  const prompt = await findOpenPrompt(message.phoneE164);
  if (!prompt) return false;
  const m = message.body.match(/\d{1,3}/);
  if (!m) return false;
  const count = Math.min(999, parseInt(m[0], 10));

  if (prompt.family_id) {
    await recordFamilyHeadCount(prompt.family_id, prompt.event_date, count, message.phoneE164);
  } else {
    await recordUnregisteredHeadCount(message.phoneE164, prompt.event_date, count);
  }
  await consumePrompt(prompt.id);

  const day = new Date(`${prompt.event_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const reply = `Shukran! Recorded ${count} from your family attending for ${day}. Reply with a new number if it changes.`;
  const metaResponse = await sendWhatsAppText(message.phoneE164, reply);
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

function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// Tell an unregistered visitor to register, and record it. Best-effort.
async function sendRegistrationNudge(phone: string, userId: string | undefined) {
  const reply =
    "Salaam. This number isn't registered for Ashara Mubaraka 1448H (Chicago) yet, so I can't assist over chat. " +
    `Please complete your family's registration here: ${appBaseUrl()}/register — then message us again and we'll be glad to help.`;
  const metaResponse = await sendWhatsAppText(phone, reply);
  await recordOutboundMessage({
    phoneE164: phone,
    body: reply,
    whatsappMessageId: metaResponse.messages?.[0]?.id,
    rawPayload: { source: "registration_gate", meta_response: metaResponse },
  });
  await touchConversationSession({ phoneE164: phone, userId });
}

async function replyToImage(message: IncomingWhatsAppMessage, userId: string | undefined) {
  const media = message.media;
  if (!media) return;

  let answer: string;
  try {
    const { buffer, mimeType } = await fetchWhatsAppMedia(media.id);
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

  const metaResponse = await sendWhatsAppText(message.phoneE164, answer);
  await recordOutboundMessage({
    phoneE164: message.phoneE164,
    body: answer,
    whatsappMessageId: metaResponse.messages?.[0]?.id,
    rawPayload: metaResponse,
  });
  await touchConversationSession({ phoneE164: message.phoneE164, userId });
}

function isAllowedBusinessPhone(message: IncomingWhatsAppMessage) {
  const allowedIds = getAllowedPhoneNumberIds();
  const allowedDisplayNumber = optionalEnv("WHATSAPP_DISPLAY_PHONE_NUMBER");
  const normalizedAllowedDisplay = allowedDisplayNumber
    ? normalizePhoneDigits(allowedDisplayNumber)
    : null;

  if (allowedIds.length > 0) {
    return Boolean(message.businessPhoneNumberId && allowedIds.includes(message.businessPhoneNumberId));
  }

  if (normalizedAllowedDisplay) {
    return normalizePhoneDigits(message.businessDisplayPhoneNumber ?? "") === normalizedAllowedDisplay;
  }

  return true;
}

function getAllowedPhoneNumberIds() {
  const configured = optionalEnv("WHATSAPP_ALLOWED_PHONE_NUMBER_IDS") ?? optionalEnv("WHATSAPP_PHONE_NUMBER_ID");
  return (configured ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizePhoneDigits(phone: string) {
  return phone.replace(/[^\d]/g, "");
}
