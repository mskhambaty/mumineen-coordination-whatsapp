import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { logEscalationActivity } from "@/lib/escalation/activity";
import { notifyDepartmentIssueContacts } from "@/lib/issues/notify";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// GET /api/admin/issues — list issues with filters
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status"); // "open" | "in_progress" | "resolved"
  const departmentId = searchParams.get("department_id");
  const priority = searchParams.get("priority"); // "low" | "medium" | "high"
  const search = searchParams.get("search");

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("issues")
    .select("*, department:departments(id, name), assignee:whatsapp_users!issues_assigned_to_fkey(id, display_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  if (departmentId && departmentId !== "all") {
    query = query.eq("department_id", departmentId);
  }
  if (priority && priority !== "all") {
    query = query.eq("priority", priority);
  }
  if (search) {
    query = query.ilike("title", `%${search}%`);
  }

  const { data: issues, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch escalation counts + breaching counts for each issue
  const issueIds = (issues ?? []).map((i) => i.id);

  let linkCounts: Map<string, { escalation_count: number; breaching_count: number }> = new Map();

  if (issueIds.length > 0) {
    const { data: links } = await supabase
      .from("issue_escalation_links")
      .select("issue_id, conversation_session_id, session:conversation_sessions!inner(escalation_sla_deadline, escalation_stage)")
      .in("issue_id", issueIds);

    const countMap = new Map<string, { escalation_count: number; breaching_count: number }>();
    const now = new Date();
    for (const link of (links ?? []) as Array<{ issue_id: string; session: { escalation_sla_deadline: string | null; escalation_stage: string } | Array<{ escalation_sla_deadline: string | null; escalation_stage: string }> }>) {
      const entry = countMap.get(link.issue_id) ?? { escalation_count: 0, breaching_count: 0 };
      entry.escalation_count++;
      const session = Array.isArray(link.session) ? link.session[0] : link.session;
      if (session?.escalation_sla_deadline && session.escalation_stage !== "resolved" && new Date(session.escalation_sla_deadline) < now) {
        entry.breaching_count++;
      }
      countMap.set(link.issue_id, entry);
    }
    linkCounts = countMap;
  }

  const enriched = (issues ?? []).map((issue) => {
    const dept = Array.isArray(issue.department) ? issue.department[0] : issue.department;
    const assignee = Array.isArray(issue.assignee) ? issue.assignee[0] : issue.assignee;
    const counts = linkCounts.get(issue.id) ?? { escalation_count: 0, breaching_count: 0 };
    return {
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
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      escalation_count: counts.escalation_count,
      breaching_count: counts.breaching_count,
    };
  });

  // Sort: priority weight desc, then created_at desc
  const priorityWeight = (p: string) => (p === "high" ? 3 : p === "medium" ? 2 : 1);
  enriched.sort((a, b) => {
    const pw = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (pw !== 0) return pw;
    return b.created_at.localeCompare(a.created_at);
  });

  return NextResponse.json({ issues: enriched });
}

// ---------------------------------------------------------------------------
// POST /api/admin/issues — create a new issue
// ---------------------------------------------------------------------------

const CreateIssueSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  department_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = CreateIssueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const { title, description, priority, department_id, assigned_to } = parsed.data;
  const callerUserId = auth.caller.user_id;

  const supabase = getSupabaseAdmin();

  const { data: issue, error } = await supabase
    .from("issues")
    .insert({
      title,
      description: description ?? null,
      priority: priority ?? "medium",
      department_id: department_id ?? null,
      assigned_to: assigned_to ?? null,
      created_by: callerUserId,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await logEscalationActivity({
      issueId: issue.id,
      action: "created_issue",
      actorUserId: callerUserId ?? undefined,
      actorLabel: auth.caller.display_name ?? undefined,
      details: { title, priority: priority ?? "medium" },
    });
  } catch { /* swallowed */ }

  // Notify department contacts (email + WhatsApp) — fire-and-forget.
  if (department_id) {
    void notifyDepartmentIssueContacts({
      issueId: issue.id,
      title,
      description: description ?? null,
      departmentId: department_id,
    });
  }

  return NextResponse.json({ issue }, { status: 201 });
}
