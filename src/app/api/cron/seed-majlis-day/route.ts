import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { DEFAULT_ACTIVE_YEAR } from "@/lib/knowledge/ashara-config";
import { majlisForDate, seedMajlisDay } from "@/lib/knowledge/seed-majlis";

export const runtime = "nodejs";
export const maxDuration = 120;

// Daily cron: ensure today's majlis has its 6 content slots seeded (English placeholders +
// Lisan pending-translation). No-op outside Ashara or when ASHARA_START_DATE is unset, so
// it's safe to schedule year-round. ASHARA_START_DATE = ISO date of Majlis 1 (2nd Muharram);
// ASHARA_YEAR overrides the Hijri year label (defaults to the active year).
export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}

async function run(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== "Bearer " + requireEnv("CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = process.env.ASHARA_START_DATE;
  if (!start) {
    return NextResponse.json({ ok: true, skipped: "ASHARA_START_DATE not set" });
  }
  const target = majlisForDate(start, Date.now());
  if (!target) {
    return NextResponse.json({ ok: true, skipped: "outside Ashara window" });
  }

  const year = process.env.ASHARA_YEAR || DEFAULT_ACTIVE_YEAR;
  const stats = await seedMajlisDay(year, target);
  return NextResponse.json({ ok: true, stats });
}
