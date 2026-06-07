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

  const messages = extractIncomingMessages(payload);

  if (messages.length === 0) {
    return NextResponse.json({ received: true, processed: 0 });
  }

  let processed = 0;

  for (const message of messages) {
    try {
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
