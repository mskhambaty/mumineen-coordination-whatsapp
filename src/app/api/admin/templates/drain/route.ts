import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { drainUntilEmpty } from "@/lib/whatsapp/broadcast";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/templates/drain — manually push any pending broadcast recipients through the send
// pipeline (bounded loop until the queue is empty). This is the one-click "Send pending" the console
// uses to unstick broadcasts when the minute cron isn't firing. It triggers real sends, so it's gated
// to admin/leadership — same as the send route. Not public.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await drainUntilEmpty();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Drain failed" }, { status: 500 });
  }
}
