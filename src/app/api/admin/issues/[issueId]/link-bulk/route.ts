import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ issueId: string }> };

// ---------------------------------------------------------------------------
// POST /api/admin/issues/[issueId]/link-bulk — bulk-link sessions to an issue
// ---------------------------------------------------------------------------

const LinkBulkSchema = z.object({
  session_ids: z.array(z.string()).min(1),
});

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { issueId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = LinkBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { session_ids } = parsed.data;
  const callerUserId = auth.caller.user_id;
  const supabase = getSupabaseAdmin();

  // Verify issue exists
  const { data: issue } = await supabase
    .from("issues")
    .select("id, title, issue_number")
    .eq("id", issueId)
    .maybeSingle();

  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  let linked_count = 0;
  let skipped_count = 0;

  for (const sessionId of session_ids) {
    // Find conversation session by id
    const { data: session } = await supabase
      .from("conversation_sessions")
      .select("id, phone_e164")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) {
      skipped_count++;
      continue;
    }

    // Insert into junction table
    const { error: linkError } = await supabase
      .from("issue_escalation_links")
      .insert({
        issue_id: issueId,
        conversation_session_id: session.id,
        linked_by: callerUserId,
      });

    if (linkError) {
      if (linkError.code === "23505") {
        // Already linked — count as skipped
        skipped_count++;
        continue;
      }
      // Unexpected error — skip this session but don't abort the whole batch
      skipped_count++;
      continue;
    }

    // Update linked_issue_id on the session
    await supabase
      .from("conversation_sessions")
      .update({ linked_issue_id: issueId })
      .eq("id", session.id);

    try {
      await logEscalationActivity({
        sessionId: session.id,
        issueId,
        phoneE164: session.phone_e164,
        action: "linked_to_issue",
        actorUserId: callerUserId ?? undefined,
        actorLabel: auth.caller.display_name ?? undefined,
        details: { issue_number: issue.issue_number, issue_title: issue.title },
      });
    } catch { /* swallowed */ }

    linked_count++;
  }

  return NextResponse.json({ linked_count, skipped_count });
}
