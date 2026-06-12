import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { notifyDepartmentIssueContacts } from "@/lib/issues/notify";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// POST /api/admin/issues/suggestions/apply — create issue + bulk-link sessions
// ---------------------------------------------------------------------------

const ApplySchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  department_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  session_ids: z.array(z.string().uuid()).min(1),
});

export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = ApplySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { title, description, priority, department_id, assigned_to, session_ids } = parsed.data;
  const callerUserId = auth.caller.user_id;

  const supabase = getSupabaseAdmin();

  // 1. Create the issue --------------------------------------------------
  const { data: issue, error: issueError } = await supabase
    .from("issues")
    .insert({
      title,
      description: description ?? null,
      priority: priority ?? "medium",
      department_id: department_id ?? null,
      assigned_to: assigned_to ?? null,
      created_by: callerUserId,
    })
    .select("id, issue_number, title, status")
    .single();

  if (issueError || !issue) {
    return NextResponse.json(
      { error: issueError?.message ?? "Failed to create issue" },
      { status: 500 },
    );
  }

  // 2. Log created_issue activity ----------------------------------------
  try {
    await logEscalationActivity({
      issueId: issue.id,
      action: "created_issue",
      actorUserId: callerUserId ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
      details: { title, priority: priority ?? "medium", source: "ai_grouping" },
    });
  } catch { /* swallowed */ }

  // 3. Bulk-link each session --------------------------------------------
  let linkedCount = 0;

  for (const sessionId of session_ids) {
    // Find conversation_session by id
    const { data: session } = await supabase
      .from("conversation_sessions")
      .select("id, phone_e164")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) continue; // session not found — skip silently

    // Insert link (skip duplicates)
    const { error: linkError } = await supabase
      .from("issue_escalation_links")
      .insert({
        issue_id: issue.id,
        conversation_session_id: session.id,
        linked_by: callerUserId,
      });

    if (linkError) {
      if (linkError.code === "23505") {
        // Already linked — still count it as "linked"
        linkedCount++;
        continue;
      }
      // Other DB errors: skip this session, continue with others
      continue;
    }

    // Update linked_issue_id on the session
    await supabase
      .from("conversation_sessions")
      .update({ linked_issue_id: issue.id })
      .eq("id", session.id);

    linkedCount++;

    // Log linked_to_issue activity for this session
    try {
      await logEscalationActivity({
        sessionId: session.id,
        issueId: issue.id,
        phoneE164: session.phone_e164,
        action: "linked_to_issue",
        actorUserId: callerUserId ?? undefined,
        actorLabel: auth.caller.display_name ?? undefined,
        details: { issue_number: issue.issue_number, issue_title: issue.title, source: "ai_grouping" },
      });
    } catch { /* swallowed */ }
  }

  // 4. Fire-and-forget department notification --------------------------
  if (department_id) {
    void notifyDepartmentIssueContacts({
      issueId: issue.id,
      title,
      description: description ?? null,
      departmentId: department_id,
    });
  }

  return NextResponse.json({ issue, linked_count: linkedCount }, { status: 201 });
}
