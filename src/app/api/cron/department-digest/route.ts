import { NextRequest, NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { mineConversationsForFeedback } from "@/lib/digest/mine-conversations";
import { runDepartmentDigest } from "@/lib/digest/run";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Department digest runner endpoint (manual/admin trigger by default; cron can be re-enabled in
// vercel.json when needed). Aggregates the day's feedback/issues/escalations + next-day
// meal totals, generates per-department + all-up AI briefings, stores them, and distributes by
// email + free in-window WhatsApp. Auth: CRON_SECRET bearer or the admin key (manual run).
// Runs at most ONCE per Chicago day (skips if that day's summaries already exist) so a schedule
// change or retry can't double-send. ?date=YYYY-MM-DD targets a specific day; ?force=1 overrides
// the once-per-day guard to deliberately regenerate/re-send.
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

  // Run at most ONCE per Chicago day: if summaries already exist for this date, skip — so a
  // schedule change (or a retry) can't re-send the day's digest to everyone. Pass ?force=1 to
  // override (e.g. to deliberately regenerate/re-send a day).
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force) {
    const { count } = await getSupabaseAdmin()
      .from("department_daily_summaries")
      .select("id", { count: "exact", head: true })
      .eq("summary_date", date);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ ok: true, skipped: "already_ran_today", date });
    }
  }

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
