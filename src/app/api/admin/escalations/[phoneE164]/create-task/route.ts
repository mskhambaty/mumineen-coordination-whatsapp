import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { notifyDepartmentIssueContacts } from "@/lib/issues/notify";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTaskPriority } from "@/lib/tasks/types";

type RouteContext = { params: Promise<{ phoneE164: string }> };

type CreateTaskBody = {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  department_id?: unknown;
};

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);
  const body = (await req.json().catch(() => ({}))) as CreateTaskBody;

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const priority = isTaskPriority(body.priority) ? body.priority : "medium";
  const departmentId = typeof body.department_id === "string" ? body.department_id : null;

  const supabase = getSupabaseAdmin();

  // Must be claimed first (picked_up stage).
  const { data: session } = await supabase
    .from("conversation_sessions")
    .select("id, escalation_stage")
    .eq("phone_e164", phone)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (session.escalation_stage !== "picked_up") {
    return NextResponse.json(
      { error: "Escalation must be claimed (picked_up) before creating a task." },
      { status: 409 },
    );
  }

  // Create the task in the existing tasks table.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      title,
      description,
      item_type: "issue",
      origin: "external",
      source: "escalation_triage",
      status: "open",
      priority,
      department_id: departmentId,
      created_by: auth.caller.user_id ?? null,
      source_phone: phone,
    })
    .select("id, title, status, priority")
    .single();

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  // Link conversation to the task and move to waiting_on_department.
  const { error: updateError } = await supabase
    .from("conversation_sessions")
    .update({
      escalation_stage: "waiting_on_department",
      linked_task_id: task.id,
      escalation_department_id: departmentId,
    })
    .eq("id", session.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Notify department contacts (fire-and-forget).
  try {
    await notifyDepartmentIssueContacts({
      issueId: task.id,
      title,
      description,
      departmentId,
    });
  } catch (err) {
    console.error("Department notification on create-task failed:", err);
  }

  try {
    await logEscalationActivity({
      sessionId: session.id,
      taskId: task.id,
      phoneE164: phone,
      action: "created_task",
      actorUserId: auth.caller.user_id ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
      details: { task_id: task.id, department_id: departmentId },
    });
  } catch { /* swallowed */ }

  return NextResponse.json({ session_id: session.id, task }, { status: 201 });
}
