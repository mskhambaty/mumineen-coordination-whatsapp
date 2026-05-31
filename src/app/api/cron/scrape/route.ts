import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { scrapeSite } from "@/lib/scraper/scrape-site";

export async function GET(req: Request) {
  return runScrape(req);
}

export async function POST(req: Request) {
  return runScrape(req);
}

async function runScrape(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = "Bearer " + requireEnv("CRON_SECRET");
  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = await scrapeSite();
  return NextResponse.json({ ok: true, stats });
}
