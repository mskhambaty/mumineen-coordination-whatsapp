import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { scrapeSite } from "@/lib/scraper/scrape-site";

export const runtime = "nodejs";
// Scrape + embed across pages can take a while; allow a long-running invocation.
export const maxDuration = 300;

// Manual site re-scrape so admins aren't dependent on the daily cron. Same work
// as /api/cron/scrape but gated by the admin key instead of the cron secret.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await scrapeSite();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
