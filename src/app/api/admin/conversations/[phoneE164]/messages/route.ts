import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { sendWhatsAppImage, sendWhatsAppText, uploadWhatsAppMedia } from "@/lib/meta/whatsapp";
import {
  getSupabaseAdmin,
  recordOutboundMessage,
  touchConversationSession,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ phoneE164: string }>;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB (WhatsApp image limit)

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);

  // Reply can be plain text (JSON) or an image attachment with an optional caption (multipart).
  let messageBody = "";
  let imageFile: File | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("image");
    imageFile = file instanceof File ? file : null;
    const caption = form?.get("caption");
    messageBody = typeof caption === "string" ? caption.trim() : "";
  } else {
    const body = (await req.json().catch(() => ({}))) as { body?: unknown; text?: unknown };
    messageBody = getMessageBody(body);
  }

  if (!imageFile && !messageBody) {
    return NextResponse.json({ error: "A message or image is required" }, { status: 400 });
  }
  if (messageBody.length > 4096) {
    return NextResponse.json({ error: "Message body is too long" }, { status: 400 });
  }
  if (imageFile) {
    if (!imageFile.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image attachments are supported" }, { status: 400 });
    }
    if (imageFile.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image is too large (max 5 MB)" }, { status: 400 });
    }
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

  let metaResponse;
  let storedBody = messageBody;
  let messageKind: "text" | "image" = "text";
  let sentMediaId: string | null = null;
  if (imageFile) {
    const buffer = Buffer.from(await imageFile.arrayBuffer());
    sentMediaId = await uploadWhatsAppMedia(buffer, imageFile.type, imageFile.name || "image");
    metaResponse = await sendWhatsAppImage(phone, sentMediaId, messageBody || undefined);
    storedBody = messageBody || "[image]";
    messageKind = "image";
  } else {
    metaResponse = await sendWhatsAppText(phone, messageBody);
  }
  const outboundId = metaResponse.messages?.[0]?.id;

  await recordOutboundMessage({
    phoneE164: phone,
    body: storedBody,
    whatsappMessageId: outboundId,
    rawPayload: {
      source: "manual_admin",
      kind: messageKind,
      // Lets the inbox proxy/render the image we just sent.
      ...(sentMediaId ? { media_id: sentMediaId } : {}),
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
