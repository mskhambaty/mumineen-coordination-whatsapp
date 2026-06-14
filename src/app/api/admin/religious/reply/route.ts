import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { sendWhatsAppText } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin, recordOutboundMessage } from "@/lib/supabase/server";

export const runtime = "nodejs";

const WINDOW_MS = 24 * 60 * 60 * 1000;

const replySchema = z.object({
  phone: z.string().min(5).max(20),
  text: z.string().trim().min(1).max(4096),
});

// POST: a monitor replies to a member from the religious dashboard.
//
// This is the ONLY place this feature touches the shared logistics conversation state, so it is
// deliberately MINIMAL:
//   - it does NOT require manual handling_mode (the member stays on the AI agent for everything
//     else — a monitor reply is a one-off message, not a takeover);
//   - it does NOT call touchConversationSession (which would reset current_intent/state and wipe an
//     in-progress utaro/parking/registration flow). It updates only last_message_at.
//   - free-form text only delivers inside WhatsApp's 24h window — outside it we refuse with 422
//     (Meta would otherwise reject with 131047). Template-send is a future addition.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const parsed = replySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A phone and message are required" }, { status: 400 });
  const { phone, text } = parsed.data;

  const supabase = getSupabaseAdmin();

  // 24h window is measured from the member's last INBOUND message (not last activity, which an
  // outbound would bump). No inbound on record → treat as out-of-window.
  const { data: lastInbound } = await supabase
    .from("messages")
    .select("created_at")
    .eq("phone_e164", phone)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastInboundAt = lastInbound?.created_at ? new Date(lastInbound.created_at).getTime() : 0;
  if (!lastInboundAt || Date.now() - lastInboundAt >= WINDOW_MS) {
    return NextResponse.json(
      { error: "This member is outside WhatsApp's 24-hour window — an approved template is required to reach them.", out_of_window: true },
      { status: 422 },
    );
  }

  const metaResponse = await sendWhatsAppText(phone, text);
  const outboundId = metaResponse.messages?.[0]?.id;

  await recordOutboundMessage({
    phoneE164: phone,
    body: text,
    whatsappMessageId: outboundId,
    rawPayload: { source: "religious_dashboard_reply", kind: "text", meta_response: metaResponse },
  });

  // State-preserving: bump only last_message_at; never touch current_intent / state / handling_mode.
  await supabase
    .from("conversation_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("phone_e164", phone);

  return NextResponse.json({ sent: true, whatsapp_message_id: outboundId ?? null });
}
