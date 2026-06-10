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

  const supabase = getSupabaseAdmin();

  const { data: session } = await supabase
    .from("conversation_sessions")
    .select("id, escalation_stage, escalation_assigned_to")
    .eq("phone_e164", phone)
    .maybeSingle();

  if (!session || session.escalation_stage !== "picked_up") {
    return NextResponse.json(
      { error: "Escalation is not currently picked up." },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({
      escalation_stage: "pending",
      escalation_assigned_to: null,
      escalation_assigned_at: null,
    })
    .eq("id", session.id)
    .select("id, phone_e164, escalation_stage, escalation_assigned_to")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Failed to release escalation." }, { status: 500 });
  }

  try {
    await logEscalationActivity({
      sessionId: data.id,
      phoneE164: phone,
      action: "released",
      actorUserId: auth.caller.user_id ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
    });
  } catch { /* swallowed */ }

  return NextResponse.json(data);
}
