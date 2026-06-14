import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { segmentCounts, windowHours } from "@/lib/whatsapp/audience";

export const runtime = "nodejs";

// GET /api/admin/templates/segments — sizes of the three Niyaz reach segments, each split into the
// free customer-service window vs the rest, for the Send Templates console header. Also returns the
// configured window size (window_hours) so the console can label the split accurately. Admin/
// leadership only. Counts only — no PII.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ segments: await segmentCounts(), window_hours: windowHours() });
}
