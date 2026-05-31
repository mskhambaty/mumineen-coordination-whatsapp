import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { addReviewFieldsToEvents, type ExistingTranscriptItems } from "@/lib/transcripts/review";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await resolveCallerFromRequest(req);
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { data: upload, error: uploadError } = await supabase
      .from("conversation_uploads")
      .select("department_id")
      .eq("id", id)
      .single();

    if (uploadError || !upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    const [milestonesResult, tasksResult] = await Promise.all([
      supabase
        .from("milestones")
        .select("id, title, status, percent_complete, budget")
        .eq("department_id", upload.department_id),
      supabase
        .from("tasks")
        .select("id, title, status, item_type")
        .eq("department_id", upload.department_id)
        .eq("archived", false),
    ]);

    const existingItems: ExistingTranscriptItems = {
      milestones: (milestonesResult.data ?? []).map((milestone) => ({
        id: milestone.id as string,
        title: (milestone.title as string | null) ?? null,
        status: (milestone.status as string | null) ?? null,
        percent_complete: (milestone.percent_complete as number | null) ?? null,
        budget: (milestone.budget as number | string | null) ?? null,
      })),
      tasks: (tasksResult.data ?? []).map((task) => ({
        id: task.id as string,
        title: (task.title as string | null) ?? null,
        status: (task.status as string | null) ?? null,
        item_type: task.item_type === "issue" ? "issue" : "task",
      })),
    };

    const { data, error } = await supabase
      .from("conversation_events")
      .select("id, upload_id, department_id, event_type, item_type, task_id, milestone_id, sender_alias, message_text, message_timestamp, ai_summary, task_title, milestone_title, assigned_to_alias, priority, confidence, percent_complete, budget, notes, description, applied")
      .eq("upload_id", id)
      .order("message_timestamp", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(addReviewFieldsToEvents(data ?? [], existingItems));
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
