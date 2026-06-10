import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ phoneE164: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);
  const callerUserId = auth.caller.user_id;

  const supabase = getSupabaseAdmin();

  // Optimistic lock: only one person can claim a pending escalation.
  // Also handle legacy tickets where escalation_stage='none' but escalation_status='pending'.
  const { data: session } = await supabase
    .from("conversation_sessions")
    .select("id, escalation_stage, escalation_status")
    .eq("phone_e164", phone)
    .maybeSingle();

  const isPending = session?.escalation_stage === "pending" ||
    (session?.escalation_stage === "none" && session?.escalation_status === "pending");

  if (!session || !isPending) {
    return NextResponse.json(
      { error: "Escalation is not pending — it may have already been claimed." },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({
      escalation_stage: "picked_up",
      escalation_assigned_to: callerUserId,
      escalation_assigned_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .select("id, phone_e164, escalation_stage, escalation_assigned_to")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Failed to claim escalation." }, { status: 500 });
  }

  try {
    await logEscalationActivity({
      sessionId: data.id,
      phoneE164: phone,
      action: "picked_up",
      actorUserId: callerUserId ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
    });
  } catch { /* swallowed */ }

  return NextResponse.json(data);
}
