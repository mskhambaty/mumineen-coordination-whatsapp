import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getMealGridTotals } from "@/lib/rsvp/meal-rsvp";

export const runtime = "nodejs";

// GET /api/admin/niyaz/meal-grid — per-slot kitchen totals (attending families + head counts) for
// the seeded meal slots, grouped client-side into a day × {lunch, dinner} matrix. Admin/leadership.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const totals = await getMealGridTotals();
  return NextResponse.json({ slots: totals });
}
