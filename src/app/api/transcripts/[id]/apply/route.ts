import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTaskPriority } from "@/lib/tasks/types";
import { buildEventReview, type ExistingTranscriptItems } from "@/lib/transcripts/review";

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

type ConversationEventRow = {
  id: string;
  event_type: string;
  item_type: "task" | "issue" | "milestone" | null;
  task_id: string | null;
  milestone_id: string | null;
  message_text: string | null;
  ai_summary: string | null;
  task_title: string | null;
  milestone_title: string | null;
  assigned_to_alias: string | null;
  priority: "low" | "medium" | "high" | null;
  percent_complete: number | null;
  budget: number | null;
  notes: string | null;
  description: string | null;
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

    let tasksCreated = 0;
    let tasksUpdated = 0;
    let milestonesCreated = 0;
    let milestonesUpdated = 0;
    let issuesCreated = 0;
    let issuesUpdated = 0;
    let eventsSkipped = 0;

    for (const event of (events ?? []) as ConversationEventRow[]) {
      const override = selectedEvents.find((se) => se.event_id === event.id);
      const priority = override?.priority ?? event.priority ?? "medium";
      const assignedToAlias = override?.assigned_to_alias ?? event.assigned_to_alias;
      const review = buildEventReview(event, existingItems);

      switch (event.event_type) {
        case "milestone_created": {
          if (review.review_action === "update" && review.target_id) {
            const updated = await updateMilestoneFromEvent(supabase, event, review.target_id);
            if (updated) {
              await supabase
                .from("conversation_events")
                .update({ applied: true, milestone_id: review.target_id })
                .eq("id", event.id);
              milestonesUpdated++;
            } else {
              eventsSkipped++;
            }
            break;
          }

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
          if (review.target_id) {
            const updated = await updateMilestoneFromEvent(supabase, event, review.target_id);
            if (updated) {
              await supabase
                .from("conversation_events")
                .update({ applied: true, milestone_id: review.target_id })
                .eq("id", event.id);
              milestonesUpdated++;
            } else {
              eventsSkipped++;
            }
          } else {
            eventsSkipped++;
          }
          break;
        }

        case "issue_created": {
          if (review.review_action === "update" && review.target_id) {
            const assignedTo = await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(supabase, event, review.target_id, priority, assignedTo);
            if (updated) {
              await supabase
                .from("conversation_events")
                .update({ applied: true, task_id: review.target_id })
                .eq("id", event.id);
              issuesUpdated++;
            } else {
              eventsSkipped++;
            }
            break;
          }

          const title = event.task_title || event.ai_summary || (event.message_text as string)?.slice(0, 100) || "Untitled Issue";
          const assignedTo = await resolveAssignedTo(supabase, assignedToAlias);

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
          if (review.target_id) {
            const assignedTo = await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(supabase, event, review.target_id, priority, assignedTo);
            if (updated) {
              await supabase.from("conversation_events").update({ applied: true, task_id: review.target_id }).eq("id", event.id);
              issuesUpdated++;
            } else {
              eventsSkipped++;
            }
          } else {
            eventsSkipped++;
          }
          break;
        }

        case "issue_resolved": {
          if (review.target_id) {
            const assignedTo = await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(supabase, event, review.target_id, priority, assignedTo, "complete");
            if (updated) {
              await supabase.from("conversation_events").update({ applied: true, task_id: review.target_id }).eq("id", event.id);
              issuesUpdated++;
            } else {
              eventsSkipped++;
            }
          } else {
            eventsSkipped++;
          }
          break;
        }

        case "task_created":
        case "decision": {
          if (review.review_action === "update" && review.target_id) {
            const assignedTo = await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(supabase, event, review.target_id, priority, assignedTo);
            if (updated) {
              await supabase
                .from("conversation_events")
                .update({ applied: true, task_id: review.target_id })
                .eq("id", event.id);
              tasksUpdated++;
            } else {
              eventsSkipped++;
            }
            break;
          }

          const title = event.task_title || event.ai_summary || (event.message_text as string)?.slice(0, 100) || "Untitled Task";
          const assignedTo = await resolveAssignedTo(supabase, assignedToAlias);

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
          if (review.target_id) {
            const assignedTo = await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(
              supabase,
              event,
              review.target_id,
              priority,
              assignedTo,
              event.event_type === "task_completed" ? "complete" : undefined,
            );
            if (updated) {
              await supabase
                .from("conversation_events")
                .update({ applied: true, task_id: review.target_id })
                .eq("id", event.id);
              tasksUpdated++;
            } else {
              eventsSkipped++;
            }
          } else {
            eventsSkipped++;
          }
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
      events_applied: Math.max(0, (events ?? []).length - eventsSkipped),
      events_skipped: eventsSkipped,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

async function resolveAssignedTo(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  assignedToAlias: string | null | undefined,
) {
  if (!assignedToAlias) return null;

  const { data: user } = await supabase
    .from("whatsapp_users")
    .select("id")
    .contains("transcript_aliases", [assignedToAlias])
    .maybeSingle();

  return (user?.id as string | undefined) ?? null;
}

async function updateTaskFromEvent(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  event: ConversationEventRow,
  taskId: string,
  priority: "low" | "medium" | "high",
  assignedTo: string | null,
  status?: "open" | "in_progress" | "blocked" | "complete",
) {
  const updates: Record<string, unknown> = { priority };
  if (assignedTo) updates.assigned_to = assignedTo;
  if (status) updates.status = status;
  if (event.description) updates.description = event.description;
  if (event.milestone_id && event.item_type === "task") updates.milestone_id = event.milestone_id;

  const { error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskId);

  return !error;
}

async function updateMilestoneFromEvent(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  event: ConversationEventRow,
  milestoneId: string,
) {
  const updates: Record<string, unknown> = {};
  if (event.percent_complete != null) {
    updates.percent_complete = event.percent_complete;
    if (event.percent_complete >= 100) updates.status = "complete";
    else if (event.percent_complete > 0) updates.status = "in_progress";
  }
  if (event.budget != null) updates.budget = event.budget;
  if (event.notes) updates.notes = event.notes;
  if (event.description) updates.description = event.description;

  if (Object.keys(updates).length === 0) return true;

  const { error } = await supabase
    .from("milestones")
    .update(updates)
    .eq("id", milestoneId);

  return !error;
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
