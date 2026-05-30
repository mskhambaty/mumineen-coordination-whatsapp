import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { sendAssignmentNotificationEmail } from "@/lib/email/postmark";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await resolveCallerFromRequest(req);
    const { id } = await params;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("milestones")
      .select("id, title, description, budget, percent_complete, status, notes, department_id, created_at, updated_at, departments(name)")
      .eq("id", id)
      .single();

    if (error) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const { data: linkedTasks } = await supabase
      .from("tasks")
      .select("id, title, status, item_type")
      .eq("milestone_id", id)
      .eq("archived", false);

    const tasks = (linkedTasks ?? []).filter((t) => t.item_type === "task" || !t.item_type);
    const issues = (linkedTasks ?? []).filter((t) => t.item_type === "issue");

    return NextResponse.json({
      ...data,
      linked_tasks: tasks.length,
      linked_tasks_complete: tasks.filter((t) => t.status === "complete").length,
      linked_issues: issues.length,
      linked_issues_resolved: issues.filter((t) => t.status === "complete").length,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;

    const supabase = getSupabaseAdmin();

    const { data: milestone } = await supabase
      .from("milestones")
      .select("department_id")
      .eq("id", id)
      .single();

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === milestone.department_id);
      if (!hasDept || hasDept.dept_role === "member") {
        return NextResponse.json({ error: "No write access" }, { status: 403 });
      }
    }

    const body = (await req.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (typeof body.title === "string") updates.title = body.title;
    if (typeof body.description === "string") updates.description = body.description;
    if (typeof body.notes === "string") updates.notes = body.notes;
    if (typeof body.budget === "number") updates.budget = body.budget;
    if (typeof body.percent_complete === "number") updates.percent_complete = Math.max(0, Math.min(100, body.percent_complete));
    if (typeof body.status === "string" && ["open", "in_progress", "blocked", "complete"].includes(body.status)) {
      updates.status = body.status;
    }
    if (typeof body.assigned_to === "string") updates.created_by = body.assigned_to;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("milestones")
      .update(updates)
      .eq("id", id)
      .select("id, title, description, budget, percent_complete, status, notes, department_id, created_by, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (typeof body.assigned_to === "string" && body.assigned_to) {
      const { data: assignee } = await supabase
        .from("whatsapp_users")
        .select("email, display_name")
        .eq("id", body.assigned_to)
        .maybeSingle();
      const { data: dept } = await supabase
        .from("departments")
        .select("name")
        .eq("id", milestone.department_id)
        .single();
      if (assignee?.email) {
        void sendAssignmentNotificationEmail(assignee.email, assignee.display_name ?? "there", "milestone", data.title, dept?.name ?? "");
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;

    const supabase = getSupabaseAdmin();

    const { data: milestone } = await supabase
      .from("milestones")
      .select("department_id")
      .eq("id", id)
      .single();

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === milestone.department_id);
      if (!hasDept || hasDept.dept_role === "member") {
        return NextResponse.json({ error: "No write access" }, { status: 403 });
      }
    }

    const { error } = await supabase.from("milestones").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
