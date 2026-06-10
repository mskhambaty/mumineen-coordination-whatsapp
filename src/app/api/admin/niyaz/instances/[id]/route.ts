import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { dateStr, oneOf, str } from "@/lib/registration/normalize";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEALS = ["lunch", "dinner"] as const;
const SERVING_TYPES = ["thaal", "packet"] as const;

const INSTANCE_COLS = "id, title, event_date, hijri_date, meal, serving_type, description, updated_at";

type InstancePatch = {
  title?: unknown;
  event_date?: unknown;
  hijri_date?: unknown;
  meal?: unknown;
  serving_type?: unknown;
  description?: unknown;
};

// PATCH /api/admin/niyaz/instances/[id] — edit a Niyaz event's day / meal / serving type / details.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
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
  if (body.event_date !== undefined) patch.event_date = dateStr(body.event_date);
  if (body.hijri_date !== undefined) patch.hijri_date = str(body.hijri_date);
  if (body.meal !== undefined) patch.meal = oneOf(body.meal, MEALS);
  if (body.serving_type !== undefined) patch.serving_type = oneOf(body.serving_type, SERVING_TYPES);
  if (body.description !== undefined) patch.description = str(body.description);

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
    return NextResponse.json({ error: "Niyaz event not found." }, { status: 404 });
  }
  return NextResponse.json({ instance: data });
}
