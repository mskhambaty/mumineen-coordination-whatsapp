import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { eventConfigPatchSchema, getEventConfig, upsertEventConfig } from "@/lib/rsvp/event-config";
import { getEvents } from "@/lib/rsvp/meal-rsvp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The event_date for a registration instance id. The day-level config is keyed by date, so the
// instance id from the route resolves to its day.
async function eventDate(id: string): Promise<string | null> {
  const ev = (await getEvents()).find((e) => e.id === id);
  return ev?.eventDate ?? null;
}

// GET — the day-level Niyaz event config for this instance's date (null if not configured yet).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const date = await eventDate(id);
  if (!date) return NextResponse.json({ error: "Event has no date." }, { status: 400 });
  const config = await getEventConfig(date);
  return NextResponse.json({ date, config });
}

// PUT — upsert the day-level config (partial patch; only provided fields are written).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const date = await eventDate(id);
  if (!date) return NextResponse.json({ error: "Event has no date." }, { status: 400 });

  const parsed = eventConfigPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const config = await upsertEventConfig(date, parsed.data);
  return NextResponse.json({ date, config });
}
