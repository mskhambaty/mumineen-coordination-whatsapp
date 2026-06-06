import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { analyzeConversationGaps } from "@/lib/knowledge/analyze-gaps";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";
// Scanning conversations + per-conversation LLM calls can take a while.
export const maxDuration = 300;

// POST: examine recent conversations for knowledge gaps and queue FAQ suggestions.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

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
