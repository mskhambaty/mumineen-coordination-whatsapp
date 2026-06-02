import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { listFaqBuckets, migrateLearnedFaqs } from "@/lib/knowledge/faq-buckets";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET: all departments with their FAQ bucket content + entry/chunk counts.
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ buckets: await listFaqBuckets() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}

// POST { action: "migrate" }: one-time sort of loose "Learned from chat" FAQs into buckets.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== "migrate") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  try {
    return NextResponse.json(await migrateLearnedFaqs());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Migration failed" }, { status: 500 });
  }
}
