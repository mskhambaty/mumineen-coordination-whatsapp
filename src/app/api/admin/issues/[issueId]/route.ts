import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ issueId: string }> };

// ---------------------------------------------------------------------------
// GET /api/admin/issues/[issueId] — issue detail with linked escalations
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { issueId } = await params;
  const supabase = getSupabaseAdmin();

  // Fetch issue with department + assignee
  const { data: issue, error } = await supabase
    .from("issues")
    .select("*, department:departments(id, name), assignee:whatsapp_users!issues_assigned_to_fkey(id, display_name), creator:whatsapp_users!issues_created_by_fkey(id, display_name)")
    .eq("id", issueId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

  // Fetch linked escalations
  const { data: links } = await supabase
    .from("issue_escalation_links")
    .select(`
      id, linked_at,
      session:conversation_sessions!inner(
        id, phone_e164, escalation_stage, escalation_priority,
        escalation_category, escalation_reason, escalated_at,
        escalation_sla_deadline, escalation_assigned_to,
        user:whatsapp_users!conversation_sessions_user_id_fkey(display_name)
      )
    `)
    .eq("issue_id", issueId)
    .order("linked_at", { ascending: false });

  // Fetch activity log
  const { data: activities } = await supabase
    .from("escalation_activity_log")
    .select("id, action, actor_label, details, created_at, conversation_session_id, task_id, issue_id")
    .eq("issue_id", issueId)
    .order("created_at", { ascending: true })
    .limit(100);

  // Also get activities from linked conversations for this issue
  const linkedSessionIds = ((links ?? []) as Array<{ session: { id: string } | Array<{ id: string }> }>)
    .map((l) => {
      const s = Array.isArray(l.session) ? l.session[0] : l.session;
      return s?.id;
    })
    .filter(Boolean) as string[];

  let sessionActivities: typeof activities = [];
  if (linkedSessionIds.length > 0) {
    const { data } = await supabase
      .from("escalation_activity_log")
      .select("id, action, actor_label, details, created_at, conversation_session_id, task_id, issue_id")
      .in("conversation_session_id", linkedSessionIds)
      .is("issue_id", null)
      .order("created_at", { ascending: true })
      .limit(100);
    sessionActivities = data;
  }

  // Merge and sort all activities
  const allActivities = [...(activities ?? []), ...(sessionActivities ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const dept = Array.isArray(issue.department) ? issue.department[0] : issue.department;
  const assignee = Array.isArray(issue.assignee) ? issue.assignee[0] : issue.assignee;
  const creator = Array.isArray(issue.creator) ? issue.creator[0] : issue.creator;

  const now = new Date();
  const escalations = ((links ?? []) as Array<{
    id: string; linked_at: string;
    session: { id: string; phone_e164: string; escalation_stage: string; escalation_priority: string; escalation_category: string; escalation_reason: string | null; escalated_at: string | null; escalation_sla_deadline: string | null; escalation_assigned_to: string | null; user: { display_name: string | null } | Array<{ display_name: string | null }> | null } | Array<{ id: string; phone_e164: string; escalation_stage: string; escalation_priority: string; escalation_category: string; escalation_reason: string | null; escalated_at: string | null; escalation_sla_deadline: string | null; escalation_assigned_to: string | null; user: { display_name: string | null } | Array<{ display_name: string | null }> | null }>;
  }>).map((link) => {
    const s = Array.isArray(link.session) ? link.session[0] : link.session;
    const u = Array.isArray(s?.user) ? s.user[0] : s?.user;
    const breaching = s?.escalation_sla_deadline && s.escalation_stage !== "resolved" && new Date(s.escalation_sla_deadline) < now;
    return {
      link_id: link.id,
      linked_at: link.linked_at,
      session_id: s?.id,
      phone_e164: s?.phone_e164,
      display_name: u?.display_name ?? null,
      escalation_stage: s?.escalation_stage,
      escalation_priority: s?.escalation_priority,
      escalation_category: s?.escalation_category,
      escalation_reason: s?.escalation_reason,
      escalated_at: s?.escalated_at,
      escalation_sla_deadline: s?.escalation_sla_deadline,
      breaching,
    };
  });

  return NextResponse.json({
    issue: {
      id: issue.id,
      issue_number: issue.issue_number,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      department_id: issue.department_id,
      department_name: dept?.name ?? null,
      assigned_to: issue.assigned_to,
      assignee_name: assignee?.display_name ?? null,
      created_by: issue.created_by,
      creator_name: creator?.display_name ?? null,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    },
    escalations,
    activities: allActivities,
  });
}

// ---------------------------------------------------------------------------
// PUT /api/admin/issues/[issueId] — update issue
// ---------------------------------------------------------------------------

const UpdateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  department_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { issueId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = UpdateIssueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("issues")
    .update(parsed.data)
    .eq("id", issueId)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

  return NextResponse.json({ issue: data });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/issues/[issueId] — delete issue
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { issueId } = await params;
  const supabase = getSupabaseAdmin();

  // Clear linked_issue_id on any linked conversations first
  await supabase
    .from("conversation_sessions")
    .update({ linked_issue_id: null })
    .eq("linked_issue_id", issueId);

  const { error } = await supabase
    .from("issues")
    .delete()
    .eq("id", issueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true });
}
