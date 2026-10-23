import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { handleInboundText } from "@/lib/agent/text-turn";
import { resolveCallerFromSession, UnauthorizedError } from "@/lib/api/auth";
import { deliverInApp, isNotificationRow, recordInAppInbound } from "@/lib/conversations/in-app";
import { getOrCreateWhatsappUser, getSupabaseAdmin, touchConversationSession } from "@/lib/supabase/server";

export const runtime = "nodejs";
// The agent reply is generated in an after() task (coalesce debounce + up to two model completions),
// same as the old WhatsApp webhook — give it the same generous cap so it isn't killed mid-reply.
export const maxDuration = 300;

const THREAD_LIMIT = 200;

// Admin-to-user outbound sources: shown as "team" in the chat (everything else outbound is the agent).
const TEAM_SOURCES = new Set(["manual_admin", "issue_close_broadcast", "religious_dashboard_reply"]);

const sendSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  visitor_mode: z.boolean().optional().default(false),
});

const afterSchema = z.string().datetime({ offset: true }).optional();

type ChatCaller = { userId: string; phoneE164: string };

// In-app agent chat: a signed-in portal user talks to the agent AS THEMSELVES, keyed on their own
// whatsapp_users.phone_e164 — so the thread, Inbox triage, and escalations match a WhatsApp
// conversation. The phone always comes from the session, never the client, so a caller can only
// ever read or write their own thread. Session-only: the admin key has no phone of its own.
async function resolveChatCaller(req: NextRequest): Promise<ChatCaller | NextResponse> {
  let caller;
  try {
    caller = await resolveCallerFromSession(req);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("agent-chat: failed to resolve session caller", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!caller.portal || !canAccessPortal(caller.portal)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: user } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .select("phone_e164")
    .eq("id", caller.user_id)
    .maybeSingle();
  const phone = typeof user?.phone_e164 === "string" ? user.phone_e164.trim() : "";
  if (!phone) {
    return NextResponse.json({ error: "Your account has no phone number, so it can't chat with the agent" }, { status: 400 });
  }
  return { userId: caller.user_id, phoneE164: phone };
}

// GET: the caller's own conversation (primary-inbox rows, notifications hidden), oldest first.
// ?after=<ISO timestamp> returns only messages at/after it (for polling).
export async function GET(req: NextRequest) {
  const auth = await resolveChatCaller(req);
  if (auth instanceof NextResponse) return auth;

  const after = afterSchema.safeParse(req.nextUrl.searchParams.get("after") ?? undefined);
  if (!after.success) {
    return NextResponse.json({ error: "after must be an ISO timestamp" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("messages")
    .select("id, direction, body, created_at, raw_payload")
    .eq("phone_e164", auth.phoneE164)
    .is("phone_number_id", null)
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);
  // gte (not gt) so a row sharing the cursor's timestamp isn't skipped; the client dedupes by id.
  if (after.data) query = query.gte("created_at", after.data);

  const [{ data, error }, { data: session }] = await Promise.all([
    query,
    supabase.from("conversation_sessions").select("handling_mode").eq("phone_e164", auth.phoneE164).maybeSingle(),
  ]);
  if (error) {
    return NextResponse.json({ error: "Failed to load conversation" }, { status: 500 });
  }

  const messages = (data ?? [])
    .filter((row) => !isNotificationRow(row))
    .reverse()
    .map((row) => ({
      id: row.id as string,
      direction: row.direction as "inbound" | "outbound",
      from: chatSender(row.direction as string, row.raw_payload),
      body: (row.body as string | null) ?? "",
      created_at: row.created_at as string,
    }));

  return NextResponse.json({ messages, handling_mode: session?.handling_mode ?? "ai" });
}

// POST: send a message as the caller. Recorded + routed through the same text pipeline the WhatsApp
// webhook used; the agent's reply lands in `messages` a few seconds later (poll GET ?after=).
export async function POST(req: NextRequest) {
  const auth = await resolveChatCaller(req);
  if (auth instanceof NextResponse) return auth;

  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A message (1–4096 characters) is required" }, { status: 400 });
  }
  const { text, visitor_mode: visitorMode } = parsed.data;

  const user = await getOrCreateWhatsappUser(auth.phoneE164);
  const inbound = await recordInAppInbound({ phoneE164: auth.phoneE164, body: text, visitorMode });
  // Inbound defines where a conversation lives: an in-app message puts it in the primary inbox.
  await touchConversationSession({ phoneE164: auth.phoneE164, userId: user.id, phoneNumberId: null });

  await handleInboundText({
    user,
    phoneE164: auth.phoneE164,
    body: text,
    messageId: inbound.messageId,
    inboundId: inbound.id,
    visitorMode,
    deliver: async (reply, extra) => {
      await deliverInApp({ phoneE164: auth.phoneE164, body: reply, rawPayload: extra, userId: user.id });
    },
  });

  return NextResponse.json({ sent: true, id: inbound.id }, { status: 201 });
}

function chatSender(direction: string, rawPayload: unknown): "you" | "agent" | "team" {
  if (direction === "inbound") return "you";
  const source = (rawPayload as { source?: unknown } | null)?.source;
  return typeof source === "string" && TEAM_SOURCES.has(source) ? "team" : "agent";
}
