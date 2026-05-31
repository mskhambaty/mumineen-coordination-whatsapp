import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTaskPriority } from "@/lib/tasks/types";
import { buildEventReview, type ExistingTranscriptItems } from "@/lib/transcripts/review";

type ApplyEventInput = {
  event_id?: unknown;
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  due_date?: unknown;
  budget?: unknown;
  percent_complete?: unknown;
  notes?: unknown;
  milestone_id?: unknown;
  assigned_to_alias?: unknown;
  assigned_to_user_id?: unknown;
};

type ApplyBody = {
  event_ids?: unknown;
  selected_events?: unknown;
  manual_events?: unknown;
};

type ManualEventInput = {
  item_type?: unknown;
  department_id?: unknown;
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  due_date?: unknown;
  milestone_id?: unknown;
  assigned_to_alias?: unknown;
  assigned_to_user_id?: unknown;
};

type NormalizedSelectedEvent = {
  event_id: string;
  title?: string;
  description?: string;
  status?: "open" | "in_progress" | "blocked" | "complete";
  priority?: "low" | "medium" | "high";
  due_date?: string | null;
  budget?: number | null;
  percent_complete?: number | null;
  notes?: string | null;
  milestone_id?: string | null;
  assigned_to_alias?: string;
  assigned_to_user_id?: string | null;
};

type ConversationEventRow = {
  id: string;
  department_id: string;
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
  suggested_status: "open" | "in_progress" | "blocked" | "complete" | null;
  due_date: string | null;
  assigned_to_user_id: string | null;
  source: string | null;
  temp_milestone_id: string | null;
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

    const { data: events, error: eventsErr } = await supabase
      .from("conversation_events")
      .select("*")
      .eq("upload_id", id)
      .in("id", eventIds)
      .eq("applied", false);

    if (eventsErr) {
      return NextResponse.json({ error: eventsErr.message }, { status: 500 });
    }

    const eventDepartments = Array.from(new Set(((events ?? []) as ConversationEventRow[]).map((event) => event.department_id)));
    if (!caller.can_write_all) {
      const writableDeptIds = new Set(
        caller.departments
          .filter((department) => department.dept_role === "pm" || department.dept_role === "hod")
          .map((department) => department.department_id),
      );
      if (eventDepartments.some((departmentId) => !writableDeptIds.has(departmentId))) {
        return NextResponse.json({ error: "Insufficient permissions for one or more selected events" }, { status: 403 });
      }
    }

    const [milestonesResult, tasksResult] = await Promise.all([
      supabase
        .from("milestones")
        .select("id, title, status, percent_complete, budget")
        .in("department_id", eventDepartments.length ? eventDepartments : [upload.department_id]),
      supabase
        .from("tasks")
        .select("id, title, status, item_type")
        .in("department_id", eventDepartments.length ? eventDepartments : [upload.department_id])
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

    const allEvents = (events ?? []) as ConversationEventRow[];
    const milestoneEvents = allEvents.filter((e) => e.event_type.startsWith("milestone"));
    const nonMilestoneEvents = allEvents.filter((e) => !e.event_type.startsWith("milestone"));
    const orderedEvents = [...milestoneEvents, ...nonMilestoneEvents];
    const tempMilestoneIdMap = new Map<string, string>();

    for (const event of orderedEvents) {
      const override = selectedEvents.find((se) => se.event_id === event.id);
      const eventToApply = applyOverrides(event, override);

      if (eventToApply.temp_milestone_id && !eventToApply.milestone_id) {
        const resolvedId = tempMilestoneIdMap.get(eventToApply.temp_milestone_id);
        if (resolvedId) eventToApply.milestone_id = resolvedId;
      }
      if (override?.milestone_id?.startsWith("temp_")) {
        const resolvedId = tempMilestoneIdMap.get(override.milestone_id);
        if (resolvedId) eventToApply.milestone_id = resolvedId;
      }

      const priority = eventToApply.priority ?? "medium";
      const assignedToAlias = eventToApply.assigned_to_alias;
      const assignedToUserId = eventToApply.assigned_to_user_id;
      const review = buildEventReview(eventToApply, existingItems);

      switch (eventToApply.event_type) {
        case "milestone_created": {
          if (review.review_action === "update" && review.target_id) {
            const updated = await updateMilestoneFromEvent(supabase, eventToApply, review.target_id);
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

          const title = eventToApply.milestone_title || eventToApply.task_title || eventToApply.ai_summary || "Untitled Milestone";
          const { data: milestone } = await supabase
            .from("milestones")
            .insert({
              title,
              department_id: eventToApply.department_id,
              description: eventToApply.description || eventToApply.message_text,
              budget: eventToApply.budget ?? null,
              percent_complete: eventToApply.percent_complete ?? 0,
              status: eventToApply.suggested_status ?? "open",
              notes: eventToApply.notes ?? null,
              created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
            })
            .select("id")
            .single();

          if (milestone) {
            if (event.temp_milestone_id) {
              tempMilestoneIdMap.set(event.temp_milestone_id, milestone.id as string);
            }
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
            const updated = await updateMilestoneFromEvent(supabase, eventToApply, review.target_id);
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
            const assignedTo = assignedToUserId ?? await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(supabase, eventToApply, review.target_id, priority, assignedTo);
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

          const title = eventToApply.task_title || eventToApply.ai_summary || (eventToApply.message_text as string)?.slice(0, 100) || "Untitled Issue";
          const assignedTo = assignedToUserId ?? await resolveAssignedTo(supabase, assignedToAlias);

          const { data: task } = await supabase
            .from("tasks")
            .insert({
              title,
              department_id: eventToApply.department_id,
              description: eventToApply.description || eventToApply.message_text,
              assigned_to: assignedTo,
              created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
              source: normalizeTaskSource(eventToApply.source),
              status: eventToApply.suggested_status ?? "open",
              due_date: eventToApply.due_date,
              priority,
              milestone_id: eventToApply.milestone_id,
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
            const assignedTo = assignedToUserId ?? await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(supabase, eventToApply, review.target_id, priority, assignedTo);
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
            const assignedTo = assignedToUserId ?? await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(supabase, eventToApply, review.target_id, priority, assignedTo, "complete");
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
            const assignedTo = assignedToUserId ?? await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(supabase, eventToApply, review.target_id, priority, assignedTo);
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

          const title = eventToApply.task_title || eventToApply.ai_summary || (eventToApply.message_text as string)?.slice(0, 100) || "Untitled Task";
          const assignedTo = assignedToUserId ?? await resolveAssignedTo(supabase, assignedToAlias);

          const { data: task } = await supabase
            .from("tasks")
            .insert({
              title,
              department_id: eventToApply.department_id,
              description: eventToApply.description || eventToApply.message_text,
              assigned_to: assignedTo,
              created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
              source: normalizeTaskSource(eventToApply.source),
              status: eventToApply.suggested_status ?? "open",
              due_date: eventToApply.due_date,
              priority,
              milestone_id: eventToApply.milestone_id,
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
            const assignedTo = assignedToUserId ?? await resolveAssignedTo(supabase, assignedToAlias);
            const updated = await updateTaskFromEvent(
              supabase,
              eventToApply,
              review.target_id,
              priority,
              assignedTo,
              eventToApply.event_type === "task_completed" ? "complete" : eventToApply.suggested_status ?? undefined,
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

    const manualEvents = normalizeManualEvents(body);
    for (const manual of manualEvents) {
      let milestoneId = manual.milestone_id;
      if (milestoneId?.startsWith("temp_") || milestoneId?.startsWith("event_")) {
        milestoneId = tempMilestoneIdMap.get(milestoneId) ?? null;
      }

      const assignedTo = manual.assigned_to_user_id ?? await resolveAssignedTo(supabase, manual.assigned_to_alias);
      const itemType = manual.item_type === "issue" ? "issue" : "task";

      const { data: task } = await supabase
        .from("tasks")
        .insert({
          title: manual.title,
          department_id: manual.department_id,
          description: manual.description,
          assigned_to: assignedTo,
          created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
          source: "manual",
          status: manual.status ?? "open",
          due_date: manual.due_date,
          priority: manual.priority ?? "medium",
          milestone_id: milestoneId,
          item_type: itemType,
        })
        .select("id")
        .single();

      if (task) {
        if (itemType === "issue") issuesCreated++;
        else tasksCreated++;
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

function applyOverrides(event: ConversationEventRow, override: NormalizedSelectedEvent | undefined): ConversationEventRow {
  if (!override) return event;

  const next: ConversationEventRow = { ...event };
  if (override.title) {
    if (next.item_type === "milestone" || next.event_type.startsWith("milestone")) {
      next.milestone_title = override.title;
    } else {
      next.task_title = override.title;
    }
    next.ai_summary = override.title;
  }
  if (override.description !== undefined) next.description = override.description;
  if (override.status) next.suggested_status = override.status;
  if (override.priority) next.priority = override.priority;
  if (override.due_date !== undefined) next.due_date = override.due_date;
  if (override.budget !== undefined) next.budget = override.budget;
  if (override.percent_complete !== undefined) next.percent_complete = override.percent_complete;
  if (override.notes !== undefined) next.notes = override.notes;
  if (override.milestone_id !== undefined) next.milestone_id = override.milestone_id;
  if (override.assigned_to_alias !== undefined) next.assigned_to_alias = override.assigned_to_alias;
  if (override.assigned_to_user_id !== undefined) next.assigned_to_user_id = override.assigned_to_user_id;
  return next;
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
  if (status ?? event.suggested_status) updates.status = status ?? event.suggested_status;
  if (event.description) updates.description = event.description;
  if (event.milestone_id && event.item_type === "task") updates.milestone_id = event.milestone_id;
  if (event.due_date) updates.due_date = event.due_date;

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
  if (event.suggested_status) updates.status = event.suggested_status;
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
        title: getOptionalString(event.title) ?? undefined,
        description: getOptionalString(event.description) ?? undefined,
        status: isStatus(event.status) ? event.status : undefined,
        priority: isTaskPriority(event.priority) ? event.priority : undefined,
        due_date: getOptionalString(event.due_date),
        budget: getOptionalNumber(event.budget),
        percent_complete: getOptionalNumber(event.percent_complete),
        notes: getOptionalString(event.notes),
        milestone_id: getOptionalString(event.milestone_id),
        assigned_to_alias: typeof event.assigned_to_alias === "string" && event.assigned_to_alias.trim()
          ? event.assigned_to_alias.trim()
          : undefined,
        assigned_to_user_id: typeof event.assigned_to_user_id === "string" && event.assigned_to_user_id.trim()
          ? event.assigned_to_user_id.trim()
          : undefined,
      }];
    });
  }

  if (Array.isArray(body.event_ids)) {
    return body.event_ids.flatMap((eventId): NormalizedSelectedEvent[] => typeof eventId === "string" ? [{ event_id: eventId }] : []);
  }

  return [];
}

function normalizeTaskSource(source: string | null | undefined) {
  if (source === "manual" || source === "whatsapp_agent") return source;
  return "transcript";
}

function isStatus(value: unknown): value is "open" | "in_progress" | "blocked" | "complete" {
  return value === "open" || value === "in_progress" || value === "blocked" || value === "complete";
}

function getOptionalString(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getOptionalNumber(value: unknown) {
  if (value === null || value === "") return null;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

type NormalizedManualEvent = {
  item_type: "task" | "issue";
  department_id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "blocked" | "complete";
  priority: "low" | "medium" | "high";
  due_date: string | null;
  milestone_id: string | null;
  assigned_to_alias: string | null;
  assigned_to_user_id: string | null;
};

function normalizeManualEvents(body: ApplyBody): NormalizedManualEvent[] {
  if (!Array.isArray(body.manual_events)) return [];

  return body.manual_events.flatMap((raw): NormalizedManualEvent[] => {
    const event = raw as ManualEventInput;
    const title = typeof event.title === "string" && event.title.trim() ? event.title.trim() : null;
    const departmentId = typeof event.department_id === "string" ? event.department_id : null;
    if (!title || !departmentId) return [];

    return [{
      item_type: event.item_type === "issue" ? "issue" : "task",
      department_id: departmentId,
      title,
      description: getOptionalString(event.description) ?? null,
      status: isStatus(event.status) ? event.status : "open",
      priority: isTaskPriority(event.priority) ? event.priority : "medium",
      due_date: getOptionalString(event.due_date) ?? null,
      milestone_id: getOptionalString(event.milestone_id) ?? null,
      assigned_to_alias: typeof event.assigned_to_alias === "string" && event.assigned_to_alias.trim()
        ? event.assigned_to_alias.trim()
        : null,
      assigned_to_user_id: typeof event.assigned_to_user_id === "string" && event.assigned_to_user_id.trim()
        ? event.assigned_to_user_id.trim()
        : null,
    }];
  });
}
