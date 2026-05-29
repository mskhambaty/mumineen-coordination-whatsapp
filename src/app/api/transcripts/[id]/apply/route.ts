import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;
    const body = await req.json();
    const { event_ids } = body as { event_ids: string[] };

    if (!event_ids || !Array.isArray(event_ids) || event_ids.length === 0) {
      return NextResponse.json({ error: "event_ids array is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Get the upload to confirm it exists and get department_id
    const { data: upload, error: uploadErr } = await supabase
      .from("conversation_uploads")
      .select("id, department_id")
      .eq("id", id)
      .single();

    if (uploadErr || !upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    // Verify write access
    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === upload.department_id);
      if (!hasDept || hasDept.dept_role === "member") {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }
    }

    // Get the events to apply
    const { data: events, error: eventsErr } = await supabase
      .from("conversation_events")
      .select("*")
      .eq("upload_id", id)
      .in("id", event_ids)
      .eq("applied", false);

    if (eventsErr) {
      return NextResponse.json({ error: eventsErr.message }, { status: 500 });
    }

    let tasksCreated = 0;
    let tasksUpdated = 0;

    for (const event of events ?? []) {
      if (event.event_type === "task_created" || event.event_type === "decision") {
        // Create a new task
        const title = (event.ai_summary as string) || (event.message_text as string)?.slice(0, 100) || "Untitled Task";

        // Resolve assigned_to if alias provided
        let assignedTo: string | null = null;
        if (event.assigned_to_alias) {
          const { data: user } = await supabase
            .from("whatsapp_users")
            .select("id")
            .contains("transcript_aliases", [event.assigned_to_alias])
            .maybeSingle();
          assignedTo = user?.id ?? null;
        }

        const { data: task } = await supabase
          .from("tasks")
          .insert({
            title,
            department_id: upload.department_id,
            description: event.message_text,
            assigned_to: assignedTo,
            created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
            source: "transcript",
          })
          .select("id")
          .single();

        if (task) {
          await supabase
            .from("conversation_events")
            .update({ applied: true, task_id: task.id })
            .eq("id", event.id);
          tasksCreated++;
        }
      } else if (event.event_type === "task_updated" || event.event_type === "task_completed") {
        // Mark event as applied (task linking would require more context)
        await supabase
          .from("conversation_events")
          .update({ applied: true })
          .eq("id", event.id);
        tasksUpdated++;
      } else {
        // info events - just mark applied
        await supabase
          .from("conversation_events")
          .update({ applied: true })
          .eq("id", event.id);
      }
    }

    return NextResponse.json({
      tasks_created: tasksCreated,
      tasks_updated: tasksUpdated,
      events_applied: (events ?? []).length,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
