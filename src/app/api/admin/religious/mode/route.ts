import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const modeSchema = z.object({
  phone: z.string().min(5).max(20),
  mode: z.enum(["ai", "manual"]),
});

// PUT: flip a conversation between AI-handled and Manual, from the Waaz Talaqqi Chats tab.
//
// Mirrors the Inbox's /conversations/[phone]/mode route, but gated for religious monitors
// (canMonitorReligiousChats) since monitors lack canAccessInbox. NOTE: handling_mode is shared
// conversation state — flipping to Manual takes the member off the AI for ALL replies (logistics
// included), exactly like the Inbox toggle. We update only handling_mode + attribution; we do NOT
// touch current_intent / state, so an in-progress flow's data is preserved.
export async function PUT(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const parsed = modeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "phone and mode (ai|manual) are required" }, { status: 400 });
  const { phone, mode } = parsed.data;

  const updates: Record<string, unknown> = {
    handling_mode: mode,
    handling_mode_at: new Date().toISOString(),
  };
  if (auth.caller.user_id !== "admin-api") updates.handling_mode_by = auth.caller.user_id;

  const { data, error } = await getSupabaseAdmin()
    .from("conversation_sessions")
    .update(updates)
    .eq("phone_e164", phone)
    .select("phone_e164, handling_mode, handling_mode_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  return NextResponse.json(data);
}
