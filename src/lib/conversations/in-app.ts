import crypto from "node:crypto";

import { IN_APP_CHANNEL, isInAppPayload } from "@/lib/conversations/channel";
import { getSupabaseAdmin, recordOutboundMessage, touchConversationSession } from "@/lib/supabase/server";

export { IN_APP_CHANNEL, isInAppPayload };

// In-app agent chat channel. With the WhatsApp number gone, a signed-in portal user talks to the
// agent from /admin/agent-chat as themselves — keyed on their own whatsapp_users.phone_e164, so the
// thread, history, Inbox triage and escalations all behave exactly like a WhatsApp conversation.
// In-app rows are marked with raw_payload.channel = "in_app" (no schema change): the Inbox labels
// them, and admin-reply paths record (instead of sending via Meta) when the conversation is in-app.

// Synthetic unique id for messages.whatsapp_message_id (the dedupe key) on in-app rows.
export function newInAppMessageId(): string {
  return `inapp:${crypto.randomUUID()}`;
}

// A conversation is in-app when its latest INBOUND message came from the in-app chat (inbound
// messages define where a conversation lives, as with the WhatsApp number split).
export async function isInAppConversation(phoneE164: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from("messages")
    .select("raw_payload")
    .eq("phone_e164", phoneE164)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return isInAppPayload(data?.raw_payload);
}

export async function recordInAppInbound(input: {
  phoneE164: string;
  body: string;
  visitorMode: boolean;
}): Promise<{ id: string; messageId: string }> {
  const messageId = newInAppMessageId();
  const { data, error } = await getSupabaseAdmin()
    .from("messages")
    .insert({
      phone_e164: input.phoneE164,
      direction: "inbound",
      whatsapp_message_id: messageId,
      body: input.body,
      message_type: "text",
      raw_payload: { channel: IN_APP_CHANNEL, visitor_mode: input.visitorMode },
      phone_number_id: null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string, messageId };
}

// Record an outbound message into an in-app conversation. There is no transport: the user's chat
// page reads it from `messages`. `touchSession: false` leaves conversation state alone (the
// religious-dashboard reply path only bumps last_message_at itself).
export async function deliverInApp(input: {
  phoneE164: string;
  body: string;
  rawPayload?: Record<string, unknown>;
  userId?: string;
  touchSession?: boolean;
}): Promise<string> {
  const messageId = newInAppMessageId();
  await recordOutboundMessage({
    phoneE164: input.phoneE164,
    body: input.body,
    whatsappMessageId: messageId,
    rawPayload: { ...(input.rawPayload ?? {}), channel: IN_APP_CHANNEL },
  });
  if (input.touchSession !== false) {
    await touchConversationSession({ phoneE164: input.phoneE164, userId: input.userId });
  }
  return messageId;
}

// Outbound rows that are notifications TO this person (template alerts, broadcasts), not part of
// their agent conversation. Hidden from the chat page so an on-call member doesn't see their own
// alert traffic in their chat.
export function isNotificationRow(row: { direction: string; body: string | null; raw_payload: unknown }): boolean {
  if (row.direction !== "outbound") return false;
  if ((row.body ?? "").startsWith("[template:")) return true;
  const source = (row.raw_payload as { source?: unknown } | null)?.source;
  return source === "template_broadcast";
}
