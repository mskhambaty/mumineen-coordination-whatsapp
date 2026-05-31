import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ phoneE164: string }>;
};

// Admin de-escalation (and manual re-escalation) from the Lead Inbox.
export async function PUT(req: NextRequest, { params }: RouteContext) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({ escalation_status: status })
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
