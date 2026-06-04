import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { requireLeadership } from "@/lib/relay-updates/auth";
import { reindexRelayUpdates } from "@/lib/relay-updates/index-updates";
import { validateRelayUpdateInput } from "@/lib/relay-updates/shared";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// PUT: full-field edit (incl. publish toggle). Body: { user_id, date, title, body, category, link?, cta?, published }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const denied = await requireLeadership(typeof body.user_id === "string" ? body.user_id : "");
  if (denied) return denied;

  const result = validateRelayUpdateInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .update({ ...result.value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Update not found." }, { status: 404 });
  }

  try {
    await reindexRelayUpdates();
  } catch (err) {
    console.error("relay updates re-index failed:", err);
  }
  return NextResponse.json({ ok: true, id: data.id });
}
