import { getSupabaseAdmin } from "@/lib/supabase/server";

export type EscalationAction =
  | "escalated"
  | "picked_up"
  | "released"
  | "created_task"
  | "linked_to_task"
  | "unlinked_from_task"
  | "resolved"
  | "bulk_resolved"
  | "reassigned"
  | "created_issue"
  | "linked_to_issue"
  | "unlinked_from_issue"
  | "issue_resolved"
  | "issue_close_notified";

export type LogActivityParams = {
  sessionId?: string;
  taskId?: string;
  issueId?: string;
  phoneE164?: string;
  action: EscalationAction;
  actorUserId?: string;
  actorLabel?: string;
  details?: Record<string, unknown>;
};

/**
 * Insert a row into escalation_activity_log.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function logEscalationActivity(params: LogActivityParams): Promise<void> {
  try {
    await getSupabaseAdmin().from("escalation_activity_log").insert({
      conversation_session_id: params.sessionId ?? null,
      task_id: params.taskId ?? null,
      issue_id: params.issueId ?? null,
      phone_e164: params.phoneE164 ?? null,
      action: params.action,
      actor_user_id: params.actorUserId ?? null,
      actor_label: params.actorLabel ?? null,
      details: params.details ?? {},
    });
  } catch (err) {
    console.error("Failed to log escalation activity:", err);
  }
}
