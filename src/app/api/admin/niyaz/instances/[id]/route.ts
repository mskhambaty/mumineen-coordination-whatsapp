import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { oneOf, str, ts } from "@/lib/registration/normalize";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

const STATUSES = ["draft", "open", "closed"] as const;

const INSTANCE_COLS =
  "id, title, status, event_at, venue_name, venue_address, description, opens_at, closes_at, created_at, updated_at";

type InstancePatch = {
  title?: unknown;
  event_at?: unknown;
  venue_name?: unknown;
  venue_address?: unknown;
  description?: unknown;
  status?: unknown;
  opens_at?: unknown;
  closes_at?: unknown;
};

// PATCH /api/admin/niyaz/instances/[id] — edit a Niyaz instance's details/status.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as InstancePatch;

  const title = str(body.title);
  if (body.title !== undefined && !title) {
    return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
  }

  // Only set provided fields, so a partial edit doesn't blank others.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) patch.title = title;
  if (body.event_at !== undefined) patch.event_at = ts(body.event_at);
  if (body.venue_name !== undefined) patch.venue_name = str(body.venue_name);
  if (body.venue_address !== undefined) patch.venue_address = str(body.venue_address);
  if (body.description !== undefined) patch.description = str(body.description);
  if (body.status !== undefined) patch.status = oneOf(body.status, STATUSES) ?? "draft";
  if (body.opens_at !== undefined) patch.opens_at = ts(body.opens_at);
  if (body.closes_at !== undefined) patch.closes_at = ts(body.closes_at);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rsvp_registration_instance")
    .update(patch)
    .eq("id", id)
    .select(INSTANCE_COLS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Niyaz instance not found." }, { status: 404 });
  }
  return NextResponse.json({ instance: data });
}
