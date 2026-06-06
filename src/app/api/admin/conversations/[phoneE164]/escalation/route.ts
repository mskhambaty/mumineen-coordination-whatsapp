import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ phoneE164: string }>;
};

// Admin de-escalation (and manual re-escalation) from the Lead Inbox.
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);
  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  const status =
    body.status === "resolved" || body.status === "pending" || body.status === "none"
      ? body.status
      : null;

  if (!status) {
    return NextResponse.json({ error: "status must be resolved, pending, or none" }, { status: 400 });
  }

  // A manual escalation from the inbox also stamps when/by-what, so it surfaces
  // like an AI escalation (reason left null — an admin can see the thread).
  const updates: Record<string, unknown> =
    status === "pending"
      ? { escalation_status: "pending", escalated_at: new Date().toISOString(), escalation_source: "manual" }
      : { escalation_status: status };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("conversation_sessions")
    .update(updates)
    .eq("phone_e164", phone)
    .select("id, phone_e164, escalation_status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
