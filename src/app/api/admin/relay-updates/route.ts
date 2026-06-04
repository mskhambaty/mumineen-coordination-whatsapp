import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { requireLeadership } from "@/lib/relay-updates/auth";
import { reindexRelayUpdatesBestEffort } from "@/lib/relay-updates/index-updates";
import { validateRelayUpdateInput } from "@/lib/relay-updates/shared";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Embedding the re-index can take a moment.
export const maxDuration = 60;

// GET: all updates (incl. unpublished) for the portal table, newest first.
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .select("id, date, title, body, category, link, cta, published, created_at, updated_at, creator:whatsapp_users!relay_updates_created_by_fkey(display_name)")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ updates: data ?? [] });
}

// POST: create an update. Body: { user_id, date, title, body, category, link?, cta?, published? }
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const denied = await requireLeadership(typeof body.user_id === "string" ? body.user_id : "");
  if (denied) return denied;

  const result = validateRelayUpdateInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .insert({ ...result.value, created_by: body.user_id as string })
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await reindexRelayUpdatesBestEffort();
  return NextResponse.json({ ok: true, id: data?.id });
}
