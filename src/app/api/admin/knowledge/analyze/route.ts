import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { analyzeConversationGaps } from "@/lib/knowledge/analyze-gaps";

export const runtime = "nodejs";
// Scanning conversations + per-conversation LLM calls can take a while.
export const maxDuration = 300;

// POST: examine recent conversations for knowledge gaps and queue FAQ suggestions.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { lookback_days?: unknown };
  const lookbackDays =
    typeof body.lookback_days === "number" && body.lookback_days > 0 && body.lookback_days <= 60
      ? Math.floor(body.lookback_days)
      : undefined;

  try {
    const result = await analyzeConversationGaps({ lookbackDays });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
