import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { resolveOpenLinksForSession, syncIssuesStatusFromLinks } from "@/lib/issues/link-status";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ phoneE164: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);
  const body = (await req.json().catch(() => ({}))) as { resolution_note?: unknown };
  const note = typeof body.resolution_note === "string" ? body.resolution_note.trim() : "";

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({
      escalation_stage: "resolved",
      escalation_status: "resolved",
      handling_mode: "ai",
      handling_mode_at: new Date().toISOString(),
    })
    .eq("phone_e164", phone)
    .in("escalation_stage", ["pending", "picked_up", "waiting_on_department"])
    .select("id, phone_e164, escalation_stage, escalation_status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "No active escalation found for this conversation." },
      { status: 404 },
    );
  }

  try {
    await logEscalationActivity({
      sessionId: data.id,
      phoneE164: phone,
      action: "resolved",
      actorUserId: auth.caller.user_id ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
      details: note ? { resolution_note: note } : undefined,
    });
  } catch { /* swallowed */ }

  // Resolve this conversation's open issue link(s) — the episode is done — and auto-close any issue
  // whose links are now all resolved.
  try {
    const affected = await resolveOpenLinksForSession(supabase, data.id, auth.caller.user_id);
    await syncIssuesStatusFromLinks(supabase, affected);
  } catch { /* non-critical */ }

  return NextResponse.json(data);
}
