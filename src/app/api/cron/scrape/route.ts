import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { scrapeSite } from "@/lib/scraper/scrape-site";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = "Bearer " + requireEnv("CRON_SECRET");
  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await scrapeSite();
  return NextResponse.json({ ok: true });
}
