import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { resolveWindowHours, segmentCounts } from "@/lib/whatsapp/audience";

export const runtime = "nodejs";

// GET /api/admin/templates/segments — sizes of the three Niyaz reach segments, each split into the
// free customer-service window vs the rest, for the Send Templates console header. An optional
// `hours` query param overrides the free-window size (clamped to 1–24; falls back to the env-
// configured default); the resolved value is echoed back as window_hours so the console can label
// the split accurately. Admin/leadership only. Counts only — no PII.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const raw = req.nextUrl.searchParams.get("hours");
  const parsed = raw == null ? undefined : Number(raw);
  const hours = resolveWindowHours(Number.isFinite(parsed) ? parsed : undefined);

  return NextResponse.json({ segments: await segmentCounts(hours), window_hours: hours });
}
