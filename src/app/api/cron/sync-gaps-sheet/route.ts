import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { syncGapsFromSheet } from "@/lib/knowledge/gaps-sheet-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}

async function run(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = "Bearer " + requireEnv("CRON_SECRET");
  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = await syncGapsFromSheet();
  return NextResponse.json({ ok: true, stats });
}
