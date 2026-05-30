import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTaskPriority } from "@/lib/tasks/types";

type ApplyEventInput = {
  event_id?: unknown;
  priority?: unknown;
  assigned_to_alias?: unknown;
};

type ApplyBody = {
  event_ids?: unknown;
  selected_events?: unknown;
};

type NormalizedSelectedEvent = {
  event_id: string;
  priority?: "low" | "medium" | "high";
  assigned_to_alias?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;
    const body = (await req.json()) as ApplyBody;
    const selectedEvents = normalizeSelectedEvents(body);
    const eventIds = selectedEvents.map((event) => event.event_id);

    if (eventIds.length === 0) {
      return NextResponse.json({ error: "event_ids or selected_events array is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: upload, error: uploadErr } = await supabase
      .from("conversation_uploads")
      .select("id, department_id")
      .eq("id", id)
      .single();

    if (uploadErr || !upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === upload.department_id);
      if (!hasDept || hasDept.dept_role === "member") {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }
    }

    const { data: events, error: eventsErr } = await supabase
      .from("conversation_events")
      .select("*")
      .eq("upload_id", id)
      .in("id", eventIds)
      .eq("applied", false);

    if (eventsErr) {
      return NextResponse.json({ error: eventsErr.message }, { status: 500 });
    }

    let tasksCreated = 0;
    let tasksUpdated = 0;
    let milestonesCreated = 0;
    let milestonesUpdated = 0;
    let issuesCreated = 0;
    let issuesUpdated = 0;

    for (const event of events ?? []) {
      const override = selectedEvents.find((se) => se.event_id === event.id);
      const priority = override?.priority ?? event.priority ?? "medium";
      const assignedToAlias = override?.assigned_to_alias ?? event.assigned_to_alias;

      switch (event.event_type) {
        case "milestone_created": {
          const title = event.milestone_title || event.task_title || event.ai_summary || "Untitled Milestone";
          const { data: milestone } = await supabase
            .from("milestones")
            .insert({
              title,
              department_id: upload.department_id,
              description: event.description || event.message_text,
              budget: event.budget ?? null,
              percent_complete: event.percent_complete ?? 0,
              notes: event.notes ?? null,
              created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
            })
            .select("id")
            .single();

          if (milestone) {
            await supabase
              .from("conversation_events")
              .update({ applied: true, milestone_id: milestone.id })
              .eq("id", event.id);
            milestonesCreated++;
          }
          break;
        }

        case "milestone_updated": {
          const milestoneTitle = event.milestone_title || event.task_title;
          if (milestoneTitle) {
            const { data: existing } = await supabase
              .from("milestones")
              .select("id")
              .eq("department_id", upload.department_id)
              .ilike("title", milestoneTitle)
              .maybeSingle();

            if (existing) {
              const updates: Record<string, unknown> = {};
              if (event.percent_complete != null) updates.percent_complete = event.percent_complete;
              if (event.budget != null) updates.budget = event.budget;
              if (event.notes) updates.notes = event.notes;

              if (Object.keys(updates).length > 0) {
                await supabase.from("milestones").update(updates).eq("id", existing.id);
              }

              await supabase
                .from("conversation_events")
                .update({ applied: true, milestone_id: existing.id })
                .eq("id", event.id);
              milestonesUpdated++;
            } else {
              await supabase.from("conversation_events").update({ applied: true }).eq("id", event.id);
            }
          } else {
            await supabase.from("conversation_events").update({ applied: true }).eq("id", event.id);
          }
          break;
        }

        case "issue_created": {
          const title = event.task_title || event.ai_summary || (event.message_text as string)?.slice(0, 100) || "Untitled Issue";
          let assignedTo: string | null = null;
          if (assignedToAlias) {
            const { data: user } = await supabase
              .from("whatsapp_users")
              .select("id")
              .contains("transcript_aliases", [assignedToAlias])
              .maybeSingle();
            assignedTo = user?.id ?? null;
          }

          const { data: task } = await supabase
            .from("tasks")
            .insert({
              title,
              department_id: upload.department_id,
              description: event.description || event.message_text,
              assigned_to: assignedTo,
              created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
              source: "transcript",
              priority,
              item_type: "issue",
            })
            .select("id")
            .single();

          if (task) {
            await supabase
              .from("conversation_events")
              .update({ applied: true, task_id: task.id })
              .eq("id", event.id);
            issuesCreated++;
          }
          break;
        }

        case "issue_updated": {
          await supabase.from("conversation_events").update({ applied: true }).eq("id", event.id);
          issuesUpdated++;
          break;
        }

        case "issue_resolved": {
          const issueTitle = event.task_title;
          if (issueTitle) {
            const { data: existing } = await supabase
              .from("tasks")
              .select("id")
              .eq("department_id", upload.department_id)
              .eq("item_type", "issue")
              .ilike("title", issueTitle)
              .neq("status", "complete")
              .maybeSingle();

            if (existing) {
              await supabase.from("tasks").update({ status: "complete" }).eq("id", existing.id);
              await supabase.from("conversation_events").update({ applied: true, task_id: existing.id }).eq("id", event.id);
            } else {
              await supabase.from("conversation_events").update({ applied: true }).eq("id", event.id);
            }
          } else {
            await supabase.from("conversation_events").update({ applied: true }).eq("id", event.id);
          }
          issuesUpdated++;
          break;
        }

        case "task_created":
        case "decision": {
          const title = event.task_title || event.ai_summary || (event.message_text as string)?.slice(0, 100) || "Untitled Task";
          let assignedTo: string | null = null;
          if (assignedToAlias) {
            const { data: user } = await supabase
              .from("whatsapp_users")
              .select("id")
              .contains("transcript_aliases", [assignedToAlias])
              .maybeSingle();
            assignedTo = user?.id ?? null;
          }

          const { data: task } = await supabase
            .from("tasks")
            .insert({
              title,
              department_id: upload.department_id,
              description: event.description || event.message_text,
              assigned_to: assignedTo,
              created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
              source: "transcript",
              priority,
              item_type: "task",
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
          break;
        }

        case "task_updated":
        case "task_completed": {
          await supabase
            .from("conversation_events")
            .update({ applied: true })
            .eq("id", event.id);
          tasksUpdated++;
          break;
        }

        default: {
          await supabase
            .from("conversation_events")
            .update({ applied: true })
            .eq("id", event.id);
          break;
        }
      }
    }

    return NextResponse.json({
      tasks_created: tasksCreated,
      tasks_updated: tasksUpdated,
      milestones_created: milestonesCreated,
      milestones_updated: milestonesUpdated,
      issues_created: issuesCreated,
      issues_updated: issuesUpdated,
      events_applied: (events ?? []).length,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

function normalizeSelectedEvents(body: ApplyBody): NormalizedSelectedEvent[] {
  if (Array.isArray(body.selected_events)) {
    return body.selected_events.flatMap((rawEvent): NormalizedSelectedEvent[] => {
      const event = rawEvent as ApplyEventInput;
      const eventId = typeof event.event_id === "string" ? event.event_id : undefined;
      if (!eventId) return [];

      return [{
        event_id: eventId,
        priority: isTaskPriority(event.priority) ? event.priority : undefined,
        assigned_to_alias: typeof event.assigned_to_alias === "string" && event.assigned_to_alias.trim()
          ? event.assigned_to_alias.trim()
          : undefined,
      }];
    });
  }

  if (Array.isArray(body.event_ids)) {
    return body.event_ids.flatMap((eventId): NormalizedSelectedEvent[] => typeof eventId === "string" ? [{ event_id: eventId }] : []);
  }

  return [];
}
