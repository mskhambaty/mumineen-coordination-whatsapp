import { NextRequest, NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { mineConversationsForFeedback } from "@/lib/digest/mine-conversations";
import { runDepartmentDigest } from "@/lib/digest/run";

export const runtime = "nodejs";
export const maxDuration = 300;

// Nightly department digest. Scheduled at 03:00 UTC (see vercel.json) = 10pm America/Chicago during
// the event (CDT, UTC-5) — Vercel crons are UTC-only and do not follow DST, so this is fixed to the
// event window; outside CDT it would land at 9pm Chicago. Committees get the recap with evening lead
// time to adjust. Aggregates the day's feedback/issues/escalations + next-day
// meal totals, generates per-department + all-up AI briefings, stores them, and distributes by
// email + free in-window WhatsApp. Auth: CRON_SECRET bearer or the admin key (manual run).
// Optional ?date=YYYY-MM-DD overrides the day (defaults to today in America/Chicago).
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${requireEnv("CRON_SECRET")}`) return true;
  const adminKey = process.env.ADMIN_API_KEY;
  return Boolean(adminKey && req.headers.get("x-admin-key") === adminKey);
}

function chicagoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dateParam = req.nextUrl.searchParams.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : chicagoToday();
  // Mine the last 24h of raw conversations for feedback first (batched, high model), so the digest
  // aggregation that follows includes everything the agent's live tool didn't catch.
  const mined = await mineConversationsForFeedback(date).catch((err) => {
    console.error("Conversation mining failed:", err);
    return { conversations: 0, chunks: 0, feedback: 0 };
  });
  const result = await runDepartmentDigest(date);
  return NextResponse.json({ ok: true, mined, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
