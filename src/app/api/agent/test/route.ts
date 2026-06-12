import { NextRequest, NextResponse } from "next/server";

import { AI_MODEL, AI_MODEL_HIGH } from "@/lib/ai/model";
import { requireAdminKey } from "@/lib/api/auth";
import { runAgent } from "@/lib/agent/run-agent";
import type { AppUser } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Eval-only endpoint: run the agent against a single message and return its reply
 * plus the tools it called, WITHOUT side effects.
 *
 * - Auth: admin key (same `x-admin-key` as the other admin routes).
 * - Side-effecting tools (move_to_escalation, create_task, …) are
 *   RECORDED but not executed — no real tickets/escalations are created.
 * - The agent does not persist messages, so test calls leave no conversation trace.
 *
 * Body: { message: string, user_type?: "external_mumineen" | "committee_member", phone?: string }
 * Response: { reply: string, tool_calls: string[] }
 */
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    user_type?: unknown;
    phone?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const isCommittee = body.user_type === "committee_member";
  // A caller may pass a real committee phone so department-scoped tools resolve;
  // otherwise we use a synthetic number (unknown caller → visitor-level context).
  const phone =
    typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : isCommittee ? "+15555550111" : "+15555550100";

  const user: AppUser = { phone_e164: phone, role: isCommittee ? "committee" : "visitor" };

  const debug = req.nextUrl.searchParams.get("debug") === "true";
  const toolCalls: string[] = [];
  const toolResults: Array<{ name: string; result: unknown }> = [];
  try {
    const reply = await runAgent(
      { user, phoneE164: phone, message },
      { toolCalls, toolResults, stubSideEffects: true },
    );
    return NextResponse.json({
      reply,
      tool_calls: toolCalls,
      ...(debug ? { tool_results: toolResults, model: AI_MODEL, model_high: AI_MODEL_HIGH } : {}),
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: messageText, tool_calls: toolCalls }, { status: 500 });
  }
}
