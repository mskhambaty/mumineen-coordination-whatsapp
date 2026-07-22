import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { syncIssueStatusFromLinks } from "@/lib/issues/link-status";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ issueId: string }> };

// ---------------------------------------------------------------------------
// POST /api/admin/issues/[issueId]/link — link an escalation to this issue
// ---------------------------------------------------------------------------

const LinkSchema = z.object({
  phone_e164: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { issueId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = LinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "phone_e164 is required" }, { status: 400 });
  }

  const { phone_e164 } = parsed.data;
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

  // Find the conversation session
  const { data: session } = await supabase
    .from("conversation_sessions")
    .select("id, escalation_stage, escalation_status")
    .eq("phone_e164", phone_e164)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Insert the link (junction table)
  const { error: linkError } = await supabase
    .from("issue_escalation_links")
    .insert({
      issue_id: issueId,
      conversation_session_id: session.id,
      linked_by: callerUserId,
    });

  if (linkError) {
    if (linkError.code === "23505") {
      return NextResponse.json({ error: "Escalation is already linked to this issue" }, { status: 409 });
    }
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  // Set linked_issue_id on the conversation session
  await supabase
    .from("conversation_sessions")
    .update({ linked_issue_id: issueId })
    .eq("id", session.id);

  try {
    await logEscalationActivity({
      sessionId: session.id,
      issueId,
      phoneE164: phone_e164,
      action: "linked_to_issue",
      actorUserId: callerUserId ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
      details: { issue_number: issue.issue_number, issue_title: issue.title },
    });
  } catch { /* swallowed */ }

  // A fresh (open) link auto-reopens a resolved issue. Non-critical — never fail the link op.
  try { await syncIssueStatusFromLinks(supabase, issueId); } catch { /* non-critical */ }

  return NextResponse.json({ linked: true, issue_number: issue.issue_number });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/issues/[issueId]/link — unlink an escalation from this issue
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { issueId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = LinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "phone_e164 is required" }, { status: 400 });
  }

  const { phone_e164 } = parsed.data;
  const callerUserId = auth.caller.user_id;
  const supabase = getSupabaseAdmin();

  // Find the conversation session
  const { data: session } = await supabase
    .from("conversation_sessions")
    .select("id")
    .eq("phone_e164", phone_e164)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Remove the link
  const { error } = await supabase
    .from("issue_escalation_links")
    .delete()
    .eq("issue_id", issueId)
    .eq("conversation_session_id", session.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Clear linked_issue_id if it pointed to this issue
  await supabase
    .from("conversation_sessions")
    .update({ linked_issue_id: null })
    .eq("id", session.id)
    .eq("linked_issue_id", issueId);

  try {
    await logEscalationActivity({
      sessionId: session.id,
      issueId,
      phoneE164: phone_e164,
      action: "unlinked_from_issue",
      actorUserId: callerUserId ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
    });
  } catch { /* swallowed */ }

  // Removing a link may leave the issue with all-resolved links → auto-close. Non-critical.
  try { await syncIssueStatusFromLinks(supabase, issueId); } catch { /* non-critical */ }

  return NextResponse.json({ unlinked: true });
}
