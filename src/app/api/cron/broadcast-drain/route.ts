import { NextRequest, NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { drainBroadcasts } from "@/lib/whatsapp/broadcast";

export const runtime = "nodejs";
export const maxDuration = 120;

// Drains queued template-broadcast recipients in a throttled batch. Scheduled frequently (see
// vercel.json) so a multi-thousand-recipient broadcast clears within ~an hour while spreading the
// fan-out (and the inbound replies it triggers) over time. Auth: CRON_SECRET bearer, or the admin
// key for manual kicks.
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${requireEnv("CRON_SECRET")}`) return true;
  const adminKey = process.env.ADMIN_API_KEY;
  return Boolean(adminKey && req.headers.get("x-admin-key") === adminKey);
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await drainBroadcasts();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
