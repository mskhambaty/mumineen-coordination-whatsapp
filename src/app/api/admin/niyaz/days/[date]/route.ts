import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal, isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { eventConfigPatchSchema, getEventConfig, upsertEventConfig } from "@/lib/rsvp/event-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET — the day-level config (niyaz_event_config) for a date (null if not configured yet).
export async function GET(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { date } = await params;
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  const config = await getEventConfig(date);
  return NextResponse.json({ date, config });
}

// PUT — upsert the day-level config (partial patch; only provided fields are written).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const { date } = await params;
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });

  const parsed = eventConfigPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const config = await upsertEventConfig(date, parsed.data);
  return NextResponse.json({ date, config });
}
