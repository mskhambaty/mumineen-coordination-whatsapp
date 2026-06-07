import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { backfillMissingThemes } from "@/lib/knowledge/religious-topics";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST: generate a one-line theme for every topic that has content but no theme yet
// (e.g. blocks indexed before the theme layer existed). Runs the AI summarizer server-side.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await backfillMissingThemes();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to backfill themes" }, { status: 500 });
  }
}
