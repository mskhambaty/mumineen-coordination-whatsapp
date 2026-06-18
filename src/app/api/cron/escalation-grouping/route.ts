import { NextRequest, NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { clusterUngroupedEscalations } from "@/lib/escalation/issue-grouping";

export const runtime = "nodejs";
export const maxDuration = 120;

// Trigger B: promote an issue when MULTIPLE conversations report the same problem. Scans ungrouped
// active escalations and clusters genuinely same-problem ones into a shared issue (see
// issue-grouping.ts — conservative: high-confidence, >=2 distinct). Scheduled in vercel.json.
// Auth: CRON_SECRET bearer, or the admin key for manual kicks.
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
  const result = await clusterUngroupedEscalations();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
