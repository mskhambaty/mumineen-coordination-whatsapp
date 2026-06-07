import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { syncDriveFaqFolder } from "@/lib/knowledge/drive-sync";

export const runtime = "nodejs";
// Listing + downloading + embedding a folder of docs can take a while.
export const maxDuration = 300;

export async function GET(req: Request) {
  return runSync(req);
}

export async function POST(req: Request) {
  return runSync(req);
}

async function runSync(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = "Bearer " + requireEnv("CRON_SECRET");
  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await syncDriveFaqFolder();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
