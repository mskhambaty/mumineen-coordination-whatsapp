import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ phoneE164: string }> };

// Link an escalated conversation to an existing task (for grouping multiple
// escalations under one venue issue).
export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);
  const body = (await req.json().catch(() => ({}))) as { task_id?: unknown };
  const taskId = typeof body.task_id === "string" ? body.task_id : "";

  if (!taskId) {
    return NextResponse.json({ error: "task_id is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Verify the task exists and isn't complete.
  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, department_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.status === "complete") {
    return NextResponse.json({ error: "Cannot link to a completed task" }, { status: 409 });
  }

  // Link and move to waiting_on_department.
  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({
      linked_task_id: taskId,
      escalation_stage: "waiting_on_department",
      escalation_department_id: task.department_id,
    })
    .eq("phone_e164", phone)
    .in("escalation_stage", ["pending", "picked_up"])
    .select("id, phone_e164, escalation_stage, linked_task_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Conversation not found or not in a linkable stage." },
      { status: 409 },
    );
  }

  try {
    await logEscalationActivity({
      sessionId: data.id,
      taskId,
      phoneE164: phone,
      action: "linked_to_task",
      actorUserId: auth.caller.user_id ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
      details: { task_id: taskId },
    });
  } catch { /* swallowed */ }

  return NextResponse.json(data);
}

// Unlink a conversation from a task.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({
      linked_task_id: null,
      escalation_stage: "picked_up",
    })
    .eq("phone_e164", phone)
    .eq("escalation_stage", "waiting_on_department")
    .select("id, phone_e164, escalation_stage, linked_task_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Conversation not found or not in waiting_on_department stage." },
      { status: 404 },
    );
  }

  try {
    await logEscalationActivity({
      sessionId: data.id,
      phoneE164: phone,
      action: "unlinked_from_task",
      actorUserId: auth.caller.user_id ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
    });
  } catch { /* swallowed */ }

  return NextResponse.json(data);
}
