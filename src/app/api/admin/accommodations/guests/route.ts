import { NextRequest, NextResponse } from "next/server";

import { buildGuestRollups } from "@/lib/accommodations/rollups";
import { requireAdminKey } from "@/lib/api/auth";

export const runtime = "nodejs";

/**
 * GET /api/admin/accommodations/guests — List awaiting-utaro guest families with demographics.
 */
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const guests = await buildGuestRollups();
    return NextResponse.json({ guests });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
