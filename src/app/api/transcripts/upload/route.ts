import { NextRequest, NextResponse } from "next/server";

import { AI_MODEL } from "@/lib/ai/model";
import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { parseTranscript, type ParsedEvent } from "@/lib/transcripts/parser";
import { getDefaultFlexiblePrompt, type TranscriptType } from "@/lib/transcripts/prompts";
import {
  addReviewFieldsToEvents,
  buildEventReview,
  type ExistingTranscriptItems,
} from "@/lib/transcripts/review";

type DepartmentRow = {
  id: string;
  name: string;
};

type MilestoneRow = {
  id: string;
  department_id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  percent_complete: number | null;
  budget: number | string | null;
  notes: string | null;
};

type TaskRow = {
  id: string;
  department_id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  item_type: "task" | "issue" | null;
  milestone_id: string | null;
  assigned_to: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high" | null;
};

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const departmentIds = parseDepartmentIds(formData);
    const transcriptTypeRaw = formData.get("transcript_type") as string | null;
    const transcriptType: TranscriptType = transcriptTypeRaw === "meeting" ? "meeting" : "whatsapp";

    if (!file || departmentIds.length === 0) {
      return NextResponse.json({ error: "file and at least one department_id are required" }, { status: 400 });
    }

    if (!caller.can_write_all) {
      const writableDeptIds = new Set(
        caller.departments
          .filter((department) => department.dept_role === "pm" || department.dept_role === "hod")
          .map((department) => department.department_id),
      );
      if (departmentIds.some((departmentId) => !writableDeptIds.has(departmentId))) {
        return NextResponse.json({ error: "No write access to one or more selected departments" }, { status: 403 });
      }
    }

    const fullContent = await file.text();
    const cutoffRaw = formData.get("cutoff_timestamp") as string | null;
    const rawContent = cutoffRaw && transcriptType === "whatsapp"
      ? trimTranscriptAfterCutoff(fullContent, cutoffRaw)
      : fullContent;
    const supabase = getSupabaseAdmin();

    const [allDepartmentsResult, selectedDepartmentsResult, promptConfigsResult, milestonesResult, tasksResult] = await Promise.all([
      supabase.from("departments").select("id, name").order("name", { ascending: true }),
      supabase.from("departments").select("id, name").in("id", departmentIds),
      supabase
        .from("department_prompt_config")
        .select("department_id, flexible_prompt")
        .in("department_id", departmentIds)
        .eq("transcript_type", transcriptType),
      supabase
        .from("milestones")
        .select("id, department_id, title, description, status, percent_complete, budget, notes")
        .in("department_id", departmentIds)
        .neq("status", "complete")
        .limit(200),
      supabase
        .from("tasks")
        .select("id, department_id, title, description, status, item_type, milestone_id, assigned_to, due_date, priority")
        .in("department_id", departmentIds)
        .eq("archived", false)
        .neq("status", "complete")
        .limit(400),
    ]);

    const allDepartments = (allDepartmentsResult.data ?? []) as DepartmentRow[];
    const selectedDepartments = orderSelectedDepartments((selectedDepartmentsResult.data ?? []) as DepartmentRow[], departmentIds);

    if (selectedDepartments.length !== departmentIds.length) {
      return NextResponse.json({ error: "One or more selected departments were not found" }, { status: 400 });
    }

    const promptConfigByDept = new Map(
      ((promptConfigsResult.data ?? []) as Array<{ department_id: string; flexible_prompt: string | null }>)
        .map((row) => [row.department_id, row.flexible_prompt?.trim() ?? ""]),
    );
    const flexiblePrompt = selectedDepartments.map((department) => {
      const savedPrompt = promptConfigByDept.get(department.id);
      const rules = savedPrompt || getDefaultFlexiblePrompt(department.name, transcriptType);
      return `Department ${department.name} (${department.id}):\n${rules}`;
    }).join("\n\n");

    const milestones = (milestonesResult.data ?? []) as MilestoneRow[];
    const tasks = (tasksResult.data ?? []) as TaskRow[];
    const existingItems: ExistingTranscriptItems = {
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        status: milestone.status,
        percent_complete: milestone.percent_complete,
        budget: milestone.budget,
      })),
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        item_type: task.item_type === "issue" ? "issue" : "task",
      })),
    };
    const existingContext = buildExistingContext(allDepartments, selectedDepartments, milestones, tasks);

    const parsed = await parseTranscript(rawContent, {
      flexiblePrompt,
      transcriptType,
      existingContext,
    });

    let lastMessageAt: string | null = null;
    if (parsed.last_message_at) {
      const d = new Date(parsed.last_message_at);
      lastMessageAt = isNaN(d.getTime()) ? null : d.toISOString();
    }

    const primaryDepartmentId = selectedDepartments[0].id;
    const { data: upload, error: uploadErr } = await supabase
      .from("conversation_uploads")
      .insert({
        department_id: primaryDepartmentId,
        uploaded_by: caller.user_id !== "admin-api" ? caller.user_id : null,
        filename: file.name,
        group_name: parsed.group_name,
        raw_content: rawContent,
        parsed_at: new Date().toISOString(),
        last_message_at: lastMessageAt,
        parsed_new_members: [],
        transcript_type: transcriptType,
      })
      .select("id")
      .single();

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    await supabase
      .from("conversation_upload_departments")
      .insert(selectedDepartments.map((department) => ({
        upload_id: upload.id,
        department_id: department.id,
      })));

    const functionCallIds = await saveFunctionCalls(supabase, {
      uploadId: upload.id as string,
      departmentIds,
      transcriptType,
      flexiblePrompt,
      existingContext,
      functionCalls: parsed.function_calls ?? [],
    });

    const firstFunctionCallId = functionCallIds[0] ?? null;
    const validDepartmentIds = new Set(departmentIds);
    const events = parsed.events.map((event) => {
      const eventDepartmentId = event.department_id && validDepartmentIds.has(event.department_id)
        ? event.department_id
        : primaryDepartmentId;
      const review = buildEventReview(toReviewEvent(event), existingItems);
      let ts: string | null = null;
      if (event.message_timestamp) {
        const d = new Date(event.message_timestamp);
        ts = isNaN(d.getTime()) ? null : d.toISOString();
      }

      return {
        upload_id: upload.id,
        department_id: eventDepartmentId,
        event_type: event.event_type,
        item_type: event.item_type ?? "task",
        task_id: review.review_action === "update" && review.review_kind !== "milestone" ? review.target_id : null,
        milestone_id: getConversationEventMilestoneId(event, review),
        sender_alias: event.sender_alias,
        message_text: event.message_text,
        message_timestamp: ts,
        ai_summary: event.ai_summary,
        task_title: event.task_title,
        milestone_title: event.milestone_title,
        assigned_to_alias: event.assigned_to_alias,
        priority: event.priority,
        confidence: null,
        percent_complete: event.percent_complete,
        budget: event.budget,
        notes: event.notes,
        description: event.description,
        suggested_status: event.status,
        due_date: normalizeDate(event.due_date),
        assigned_to_user_id: event.assigned_to,
        source: event.source,
        function_call_id: firstFunctionCallId,
        raw_function_event: event.raw_function_event ?? null,
        suggested_changes: event.raw_function_event?.data ?? null,
        temp_milestone_id: event.temp_milestone_id ?? null,
        applied: false,
      };
    });

    if (events.length > 0) {
      const { error: eventsErr } = await supabase
        .from("conversation_events")
        .insert(events);

      if (eventsErr) {
        console.error("Failed to insert conversation events:", eventsErr);
        return NextResponse.json({
          error: `Parsed ${events.length} transcript proposals, but could not save them for review: ${eventsErr.message}`,
          parsed_events_count: events.length,
        }, { status: 500 });
      }
    }

    const selectColumns = "id, upload_id, department_id, event_type, item_type, task_id, milestone_id, sender_alias, message_text, message_timestamp, ai_summary, task_title, milestone_title, assigned_to_alias, priority, percent_complete, budget, notes, description, suggested_status, due_date, assigned_to_user_id, source, raw_function_event, suggested_changes, temp_milestone_id, applied";
    const { data: savedEvents, error: savedEventsErr } = await supabase
      .from("conversation_events")
      .select(selectColumns)
      .eq("upload_id", upload.id)
      .order("message_timestamp", { ascending: true });

    if (savedEventsErr) {
      console.error("Failed to load saved conversation events:", savedEventsErr);
      return NextResponse.json({
        error: `Parsed ${events.length} transcript proposals, but could not load them for review: ${savedEventsErr.message}`,
        parsed_events_count: events.length,
      }, { status: 500 });
    }

    return NextResponse.json({
      upload_id: upload.id,
      group_name: parsed.group_name,
      departments: selectedDepartments,
      existing_items: buildExistingItemsTree(selectedDepartments, milestones, tasks),
      events: addReviewFieldsToEvents(savedEvents ?? [], existingItems),
      new_members: [],
      function_calls_saved: functionCallIds.length,
      flexible_prompt: flexiblePrompt,
      transcript_type: transcriptType,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

function parseDepartmentIds(formData: FormData) {
  const ids = new Set<string>();

  for (const raw of formData.getAll("department_ids")) {
    if (typeof raw !== "string") continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === "string" && id.trim()) ids.add(id.trim());
        });
        continue;
      }
    } catch {
      // Fall through to comma/newline handling.
    }

    raw.split(/[,\n]/).forEach((id) => {
      if (id.trim()) ids.add(id.trim());
    });
  }

  const singleDepartmentId = formData.get("department_id");
  if (typeof singleDepartmentId === "string" && singleDepartmentId.trim()) {
    ids.add(singleDepartmentId.trim());
  }

  return Array.from(ids);
}

function orderSelectedDepartments(departments: DepartmentRow[], departmentIds: string[]) {
  const byId = new Map(departments.map((department) => [department.id, department]));
  return departmentIds.flatMap((id) => {
    const department = byId.get(id);
    return department ? [department] : [];
  });
}

function buildExistingContext(
  allDepartments: DepartmentRow[],
  selectedDepartments: DepartmentRow[],
  milestones: MilestoneRow[],
  tasks: TaskRow[],
) {
  const sections: string[] = [];
  sections.push("All departments and department IDs:\n" + allDepartments.map((department) =>
    `- ${department.name}: ${department.id}`
  ).join("\n"));
  sections.push("Selected departments for this upload:\n" + selectedDepartments.map((department) =>
    `- ${department.name}: ${department.id}`
  ).join("\n"));

  if (milestones.length) {
    sections.push("Open milestones for selected departments:\n" + milestones.map((milestone) =>
      `- [${milestone.id}] dept=${milestone.department_id} "${milestone.title}" status=${milestone.status} percent_complete=${milestone.percent_complete ?? "N/A"} budget=${milestone.budget ?? "N/A"} notes=${milestone.notes ?? ""}`
    ).join("\n"));
  }

  if (tasks.length) {
    sections.push("Open tasks/issues for selected departments:\n" + tasks.map((task) =>
      `- [${task.id}] dept=${task.department_id} milestone=${task.milestone_id ?? "none"} type=${task.item_type ?? "task"} "${task.title}" status=${task.status} priority=${task.priority ?? "medium"} due=${task.due_date ?? "none"}`
    ).join("\n"));
  }

  return sections.join("\n\n");
}

function buildExistingItemsTree(
  selectedDepartments: DepartmentRow[],
  milestones: MilestoneRow[],
  tasks: TaskRow[],
) {
  return selectedDepartments.map((department) => {
    const deptMilestones = milestones.filter((milestone) => milestone.department_id === department.id);
    const unassignedTasks = tasks.filter((task) => task.department_id === department.id && !task.milestone_id);

    return {
      department,
      milestones: deptMilestones.map((milestone) => ({
        ...milestone,
        tasks: tasks.filter((task) => task.milestone_id === milestone.id && task.item_type !== "issue"),
        issues: tasks.filter((task) => task.milestone_id === milestone.id && task.item_type === "issue"),
      })),
      unassigned_tasks: unassignedTasks.filter((task) => task.item_type !== "issue"),
      unassigned_issues: unassignedTasks.filter((task) => task.item_type === "issue"),
    };
  });
}

function toReviewEvent(event: ParsedEvent) {
  return {
    ...event,
    task_id: event.item_type !== "milestone" ? event.id ?? null : null,
    milestone_id: event.item_type === "milestone" ? event.id ?? event.milestone_id ?? null : null,
  };
}

function getConversationEventMilestoneId(event: ParsedEvent, review: ReturnType<typeof buildEventReview>) {
  if (review.review_action === "update" && review.review_kind === "milestone") {
    return review.target_id;
  }

  if (event.item_type === "milestone") {
    return event.id ?? event.milestone_id ?? null;
  }

  return event.milestone_id ?? null;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function toJsonValue(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return null;
  }
}

async function saveFunctionCalls(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  input: {
    uploadId: string;
    departmentIds: string[];
    transcriptType: TranscriptType;
    flexiblePrompt: string;
    existingContext: string;
    functionCalls: NonNullable<Awaited<ReturnType<typeof parseTranscript>>["function_calls"]>;
  },
) {
  const ids: string[] = [];

  for (const call of input.functionCalls) {
    const { data } = await supabase
      .from("transcript_function_calls")
      .insert({
        upload_id: input.uploadId,
        department_ids: input.departmentIds,
        transcript_type: input.transcriptType,
        function_name: call.function_name,
        model: AI_MODEL,
        request_prompt: input.flexiblePrompt,
        request_context: {
          existing_context: input.existingContext,
          department_ids: input.departmentIds,
        },
        raw_response: toJsonValue(call.raw_response),
        arguments: call.arguments,
        parse_error: call.parse_error,
        status: call.status,
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (data?.id) ids.push(data.id as string);
  }

  return ids;
}

function trimTranscriptAfterCutoff(content: string, cutoffIso: string): string {
  const cutoff = new Date(cutoffIso);
  if (isNaN(cutoff.getTime())) return content;

  const lines = content.split("\n");
  const result: string[] = [];
  let pastCutoff = false;

  for (const rawLine of lines) {
    if (pastCutoff) {
      result.push(rawLine);
      continue;
    }

    const ts = extractLineTimestamp(rawLine);
    if (ts && ts > cutoff) {
      pastCutoff = true;
      result.push(rawLine);
    } else if (!ts && result.length > 0) {
      result.push(rawLine);
    }
  }

  return result.length > 0 ? result.join("\n") : content;
}

function extractLineTimestamp(line: string): Date | null {
  const cleaned = line.replace(/[‎‏‪-‮⁦-⁩]/g, "");

  const bracketed = cleaned.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))\]/i);
  if (bracketed) return parseTimeParts(bracketed[1], bracketed[2]);

  const dashed = cleaned.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s+-/i);
  if (dashed) return parseTimeParts(dashed[1], dashed[2]);

  return null;
}

function parseTimeParts(datePart: string, timePart: string): Date | null {
  const [monthRaw, dayRaw, yearRaw] = datePart.split("/").map(Number);
  const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!monthRaw || !dayRaw || !yearRaw || !timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  const meridiem = timeMatch[4]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const date = new Date(year, monthRaw - 1, dayRaw, hour, minute, second);
  return isNaN(date.getTime()) ? null : date;
}
