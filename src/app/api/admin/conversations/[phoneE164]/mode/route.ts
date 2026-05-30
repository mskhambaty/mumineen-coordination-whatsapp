import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ phoneE164: string }>;
};

export async function PUT(req: NextRequest, { params }: RouteContext) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);
  const body = (await req.json().catch(() => ({}))) as { mode?: unknown; user_id?: unknown };
  const mode = body.mode === "manual" ? "manual" : body.mode === "ai" ? "ai" : null;

  if (!mode) {
    return NextResponse.json({ error: "mode must be ai or manual" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const updates: Record<string, unknown> = {
    handling_mode: mode,
    handling_mode_at: new Date().toISOString(),
  };

  if (typeof body.user_id === "string" && /^[0-9a-f-]{36}$/i.test(body.user_id)) {
    updates.handling_mode_by = body.user_id;
  }

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update(updates)
    .eq("phone_e164", phone)
    .select("id, phone_e164, handling_mode, handling_mode_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
