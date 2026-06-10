import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ issueId: string }> };

// ---------------------------------------------------------------------------
// POST /api/admin/issues/[issueId]/resolve — resolve issue + all linked escalations
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { issueId } = await params;
  const callerUserId = auth.caller.user_id;
  const supabase = getSupabaseAdmin();

  // Verify issue exists and is not already resolved
  const { data: issue } = await supabase
    .from("issues")
    .select("id, issue_number, title, status")
    .eq("id", issueId)
    .maybeSingle();

  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }
  if (issue.status === "resolved") {
    return NextResponse.json({ error: "Issue is already resolved" }, { status: 409 });
  }

  // Resolve the issue
  const { error: updateError } = await supabase
    .from("issues")
    .update({ status: "resolved" })
    .eq("id", issueId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Find all linked conversations that are not yet resolved
  const { data: links } = await supabase
    .from("issue_escalation_links")
    .select("conversation_session_id, session:conversation_sessions!inner(id, phone_e164, escalation_stage)")
    .eq("issue_id", issueId);

  let resolvedCount = 0;

  for (const link of (links ?? []) as Array<{ conversation_session_id: string; session: { id: string; phone_e164: string; escalation_stage: string } | Array<{ id: string; phone_e164: string; escalation_stage: string }> }>) {
    const session = Array.isArray(link.session) ? link.session[0] : link.session;
    if (!session || session.escalation_stage === "resolved") continue;

    const { error } = await supabase
      .from("conversation_sessions")
      .update({
        escalation_stage: "resolved",
        escalation_status: "resolved",
      })
      .eq("id", session.id);

    if (!error) {
      resolvedCount++;
      try {
        await logEscalationActivity({
          sessionId: session.id,
          issueId,
          phoneE164: session.phone_e164,
          action: "issue_resolved",
          actorUserId: callerUserId ?? undefined,
          actorLabel: auth.caller.display_name ?? undefined,
          details: { issue_number: issue.issue_number, issue_title: issue.title },
        });
      } catch { /* swallowed */ }
    }
  }

  return NextResponse.json({
    issue: { id: issue.id, issue_number: issue.issue_number, status: "resolved" },
    conversations_resolved: resolvedCount,
  });
}
