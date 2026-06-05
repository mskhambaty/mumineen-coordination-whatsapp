import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { resolveRecipient, sendRsvpPrompt, type SendMode } from "@/lib/niyaz/send";
import { str } from "@/lib/registration/normalize";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODES: SendMode[] = ["button", "text", "text_plain"];

type SendBody = { its?: unknown; phone?: unknown; mode?: unknown };

// POST /api/admin/niyaz/instances/[id]/send — send an RSVP prompt to ONE recipient (ITS or phone)
// and open a tracking row so the reply is auto-captured. Single-recipient (test) for now.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as SendBody;

  const mode = (str(body.mode) ?? "") as SendMode;
  if (!MODES.includes(mode)) {
    return NextResponse.json({ error: "Mode must be button, text, or text_plain." }, { status: 400 });
  }
  const itsOrPhone = str(body.its) ?? str(body.phone);
  if (!itsOrPhone) {
    return NextResponse.json({ error: "Enter an ITS or phone number." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: instance } = await supabase
    .from("rsvp_registration_instance")
    .select("id, title, event_at, venue_name, status")
    .eq("id", id)
    .maybeSingle();
  if (!instance) return NextResponse.json({ error: "Niyaz instance not found." }, { status: 404 });
  if (instance.status !== "open") {
    return NextResponse.json({ error: "Open the campaign before sending RSVPs." }, { status: 400 });
  }

  try {
    const recipient = await resolveRecipient(itsOrPhone);
    const { promptId, waMessageId } = await sendRsvpPrompt({ instance, recipient, mode });
    return NextResponse.json({
      ok: true,
      prompt_id: promptId,
      wa_message_id: waMessageId,
      to: recipient.phone,
      name: recipient.displayName,
      mode,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 400 });
  }
}
