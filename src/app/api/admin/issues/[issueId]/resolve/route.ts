import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { sendWhatsAppText } from "@/lib/meta/whatsapp";
import {
  getSupabaseAdmin,
  recordOutboundMessage,
  touchConversationSession,
} from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ issueId: string }> };

// ---------------------------------------------------------------------------
// POST /api/admin/issues/[issueId]/resolve — close issue, notify & resolve
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { issueId } = await params;
  const callerUserId = auth.caller.user_id;
  const supabase = getSupabaseAdmin();

  // Parse optional body — all fields default so an empty body preserves old behavior.
  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    resolve_escalations?: unknown;
    close_issue?: unknown;
  };

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  const resolveEscalations = body.resolve_escalations !== false;
  const closeIssue = body.close_issue !== false;

  if (message.length > 4096) {
    return NextResponse.json(
      { error: "Message is too long (max 4096 characters)" },
      { status: 400 },
    );
  }

  // Verify issue exists and is not already resolved (when closing).
  const { data: issue } = await supabase
    .from("issues")
    .select("id, issue_number, title, status")
    .eq("id", issueId)
    .maybeSingle();

  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }
  if (closeIssue && issue.status === "resolved") {
    return NextResponse.json(
      { error: "Issue is already resolved" },
      { status: 409 },
    );
  }

  // Close the issue if requested.
  if (closeIssue) {
    const { error: updateError } = await supabase
      .from("issues")
      .update({ status: "resolved" })
      .eq("id", issueId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }
  }

  // Fetch all linked conversations.
  const { data: links } = await supabase
    .from("issue_escalation_links")
    .select(
      "conversation_session_id, session:conversation_sessions!inner(id, phone_e164, escalation_stage)",
    )
    .eq("issue_id", issueId);

  type LinkedSession = {
    conversation_session_id: string;
    session:
      | { id: string; phone_e164: string; escalation_stage: string }
      | Array<{ id: string; phone_e164: string; escalation_stage: string }>;
  };

  let resolvedCount = 0;
  let messagesSent = 0;
  let messagesFailed = 0;
  const failedPhones: string[] = [];

  for (const link of (links ?? []) as LinkedSession[]) {
    const session = Array.isArray(link.session)
      ? link.session[0]
      : link.session;
    if (!session) continue;

    // Send WhatsApp message if provided.
    if (message) {
      try {
        const metaResponse = await sendWhatsAppText(
          session.phone_e164,
          message,
        );
        const outboundId = metaResponse.messages?.[0]?.id;
        await recordOutboundMessage({
          phoneE164: session.phone_e164,
          body: message,
          whatsappMessageId: outboundId,
          rawPayload: {
            source: "issue_close_broadcast",
            issue_id: issueId,
            issue_number: issue.issue_number,
          },
        });
        await touchConversationSession({
          phoneE164: session.phone_e164,
        });
        messagesSent++;

        try {
          await logEscalationActivity({
            sessionId: session.id,
            issueId,
            phoneE164: session.phone_e164,
            action: "issue_close_notified",
            actorUserId: callerUserId ?? undefined,
            actorLabel: auth.caller.display_name ?? undefined,
            details: {
              issue_number: issue.issue_number,
              message_preview: message.substring(0, 100),
            },
          });
        } catch {
          /* swallowed */
        }
      } catch {
        messagesFailed++;
        failedPhones.push(session.phone_e164);
      }
    }

    // Resolve escalation if requested and not already resolved.
    if (resolveEscalations && session.escalation_stage !== "resolved") {
      const { error } = await supabase
        .from("conversation_sessions")
        .update({
          escalation_stage: "resolved",
          escalation_status: "resolved",
          handling_mode: "ai",
          handling_mode_at: new Date().toISOString(),
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
            details: {
              issue_number: issue.issue_number,
              issue_title: issue.title,
            },
          });
        } catch {
          /* swallowed */
        }
      }
    }
  }

  return NextResponse.json({
    issue: {
      id: issue.id,
      issue_number: issue.issue_number,
      status: closeIssue ? "resolved" : issue.status,
    },
    conversations_resolved: resolvedCount,
    messages_sent: messagesSent,
    messages_failed: messagesFailed,
    ...(failedPhones.length > 0 ? { failed_phones: failedPhones } : {}),
  });
}
