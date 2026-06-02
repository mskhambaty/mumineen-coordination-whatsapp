import { NextRequest, NextResponse } from "next/server";

import { runAgent } from "@/lib/agent/run-agent";
import { answerImageQuestion } from "@/lib/agent/vision";
import { optionalEnv } from "@/lib/env";
import { fetchWhatsAppMedia, sendWhatsAppText, verifyMetaSignature } from "@/lib/meta/whatsapp";
import {
  getSupabaseAdmin,
  getOrCreateWhatsappUser,
  recordInboundMessage,
  recordOutboundMessage,
  touchConversationSession,
} from "@/lib/supabase/server";
import { extractIncomingMessages, type IncomingWhatsAppMessage } from "@/lib/whatsapp/parser";

export const runtime = "nodejs";

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

  // A reaction (e.g. 👍) isn't a question — record it for the inbox but never reply.
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

  // Images are handled in isolation: the vision model answers about THIS image only,
  // and we send that answer directly — bypassing the text agent's history and site RAG
  // so unrelated event context (e.g. hotels) can never bleed in and cause hallucinations.
  if (message.media) {
    await replyToImage(message, user.id);
    return true;
  }

  // Nothing to respond to — e.g. an "unsupported"/stray message type (WhatsApp sometimes
  // sends one alongside an image) or an empty payload. Stay silent instead of nagging.
  if (!message.body.trim()) {
    return true;
  }

  const reply = await runAgent({
    user,
    phoneE164: message.phoneE164,
    message: message.body,
  });

  // The agent can choose to stay silent on content-free closings ("thanks", "ok",
  // a dua already acknowledged, etc.) by returning the no-reply sentinel. Strip the
  // token first so it can never leak into an actual message; if nothing remains, stay silent.
  const cleaned = reply.replace(/\[\[\s*no[_\s]?reply\s*\]\]/gi, "").trim();
  if (isSilentReply(cleaned)) {
    return true;
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

  return true;
}

// True when the agent's reply means "send nothing" — empty, or the no-reply sentinel
// in any reasonable shape the model might emit ("[[NO_REPLY]]", "NO_REPLY", etc.).
function isSilentReply(reply: string): boolean {
  const trimmed = reply.trim();
  if (!trimmed) return true;
  return trimmed.replace(/[^a-z]/gi, "").toUpperCase() === "NOREPLY";
}

// Download the image, ask the vision model about it (this image only), and send the
// answer straight to the visitor. Fully isolated from the text agent / RAG / history.
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
