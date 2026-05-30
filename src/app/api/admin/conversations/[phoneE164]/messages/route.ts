import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { sendWhatsAppText } from "@/lib/meta/whatsapp";
import {
  getSupabaseAdmin,
  recordOutboundMessage,
  touchConversationSession,
} from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ phoneE164: string }>;
};

export async function POST(req: NextRequest, { params }: RouteContext) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);
  const body = (await req.json().catch(() => ({}))) as { body?: unknown; text?: unknown };
  const messageBody = getMessageBody(body);

  if (!messageBody) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }
  if (messageBody.length > 4096) {
    return NextResponse.json({ error: "Message body is too long" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: session, error: sessionError } = await supabase
    .from("conversation_sessions")
    .select("id, user_id, handling_mode")
    .eq("phone_e164", phone)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (session.handling_mode !== "manual") {
    return NextResponse.json(
      { error: "Switch the conversation to Manual mode before sending a reply" },
      { status: 400 },
    );
  }

  const metaResponse = await sendWhatsAppText(phone, messageBody);
  const outboundId = metaResponse.messages?.[0]?.id;

  await recordOutboundMessage({
    phoneE164: phone,
    body: messageBody,
    whatsappMessageId: outboundId,
    rawPayload: {
      source: "manual_admin",
      meta_response: metaResponse,
    },
  });

  await touchConversationSession({
    phoneE164: phone,
    userId: typeof session.user_id === "string" ? session.user_id : undefined,
  });

  return NextResponse.json({ sent: true, whatsapp_message_id: outboundId ?? null });
}

function getMessageBody(body: { body?: unknown; text?: unknown }) {
  const value = typeof body.body === "string" ? body.body : body.text;
  return typeof value === "string" ? value.trim() : "";
}
