import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ taskId: string }> };

// Resolve a task AND bulk-resolve all conversations linked to it.
export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { taskId } = await params;
  const supabase = getSupabaseAdmin();

  // Mark the task as complete.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .update({ status: "complete" })
    .eq("id", taskId)
    .neq("status", "complete")
    .select("id, title, status")
    .maybeSingle();

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "Task not found or already complete" }, { status: 404 });
  }

  // Bulk-resolve all linked conversations that aren't already resolved.
  const { data: resolved, error: resolveError } = await supabase
    .from("conversation_sessions")
    .update({
      // escalation_status is derived from escalation_stage by a DB trigger — set stage only.
      escalation_stage: "resolved",
    })
    .eq("linked_task_id", taskId)
    .neq("escalation_stage", "resolved")
    .select("id, phone_e164");

  if (resolveError) {
    return NextResponse.json({ error: resolveError.message }, { status: 500 });
  }

  // Log activity for each bulk-resolved conversation (fire-and-forget).
  const resolvedSessions = resolved ?? [];
  for (const session of resolvedSessions) {
    try {
      await logEscalationActivity({
        sessionId: session.id,
        taskId,
        phoneE164: session.phone_e164,
        action: "bulk_resolved",
        actorUserId: auth.caller.user_id ?? undefined,
        actorLabel: auth.caller.display_name ?? undefined,
        details: { task_id: taskId, task_title: task.title },
      });
    } catch { /* swallowed */ }
  }

  return NextResponse.json({
    task,
    conversations_resolved: resolvedSessions.length,
  });
}
