import { NextRequest, NextResponse } from "next/server";

import { runAgent } from "@/lib/agent/run-agent";
import { optionalEnv } from "@/lib/env";
import { sendWhatsAppText, verifyMetaSignature } from "@/lib/meta/whatsapp";
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
  const inbound = await recordInboundMessage(message);

  if (!inbound.inserted) {
    return false;
  }

  const user = await getOrCreateWhatsappUser(message.phoneE164, message.profileName);

  await touchConversationSession({
    phoneE164: message.phoneE164,
    userId: user.id,
  });

  const { data: session } = await getSupabaseAdmin()
    .from("conversation_sessions")
    .select("handling_mode")
    .eq("phone_e164", message.phoneE164)
    .maybeSingle();

  if (session?.handling_mode === "manual") {
    return true;
  }

  const reply = await runAgent({
    user,
    phoneE164: message.phoneE164,
    message: message.body,
  });

  const metaResponse = await sendWhatsAppText(message.phoneE164, reply);
  const outboundId = metaResponse.messages?.[0]?.id;

  await recordOutboundMessage({
    phoneE164: message.phoneE164,
    body: reply,
    whatsappMessageId: outboundId,
    rawPayload: metaResponse,
  });

  await touchConversationSession({
    phoneE164: message.phoneE164,
    userId: user.id,
  });

  return true;
}
