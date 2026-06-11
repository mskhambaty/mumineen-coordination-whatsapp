import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { segmentCounts } from "@/lib/whatsapp/audience";

export const runtime = "nodejs";

// GET /api/admin/templates/segments — sizes of the three Niyaz reach segments, each split into the
// free 24h-window vs the rest, for the Send Templates console header. Admin/leadership only. Counts
// only — no PII.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ segments: await segmentCounts() });
}
