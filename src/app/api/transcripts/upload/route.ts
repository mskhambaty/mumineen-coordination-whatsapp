import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { parseTranscript } from "@/lib/transcripts/parser";
import { getDefaultFlexiblePrompt, type TranscriptType } from "@/lib/transcripts/prompts";
import {
  addReviewFieldsToEvents,
  buildEventReview,
  filterUnknownNewMembers,
  type ExistingTranscriptItems,
  type ExistingTranscriptUser,
} from "@/lib/transcripts/review";

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const departmentId = formData.get("department_id") as string | null;
    const transcriptTypeRaw = formData.get("transcript_type") as string | null;
    const transcriptType: TranscriptType = transcriptTypeRaw === "meeting" ? "meeting" : "whatsapp";

    if (!file || !departmentId) {
      return NextResponse.json({ error: "file and department_id are required" }, { status: 400 });
    }

    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === departmentId);
      if (!hasDept || hasDept.dept_role === "member") {
        return NextResponse.json({ error: "No write access to this department" }, { status: 403 });
      }
    }

    const rawContent = await file.text();
    const supabase = getSupabaseAdmin();

    const { data: department } = await supabase
      .from("departments")
      .select("name")
      .eq("id", departmentId)
      .single();

    const [promptConfigResult, milestonesResult, tasksResult, usersResult] = await Promise.all([
      supabase
        .from("department_prompt_config")
        .select("flexible_prompt")
        .eq("department_id", departmentId)
        .eq("transcript_type", transcriptType)
        .maybeSingle(),
      supabase
        .from("milestones")
        .select("id, title, status, percent_complete, budget")
        .eq("department_id", departmentId)
        .limit(50),
      supabase
        .from("tasks")
        .select("id, title, status, item_type, milestone_id")
        .eq("department_id", departmentId)
        .eq("archived", false)
        .limit(100),
      supabase
        .from("whatsapp_users")
        .select("display_name, transcript_aliases")
        .limit(500),
    ]);

    const flexiblePrompt = promptConfigResult.data?.flexible_prompt || getDefaultFlexiblePrompt(department?.name, transcriptType);
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
    const existingUsers: ExistingTranscriptUser[] = (usersResult.data ?? []).map((user) => ({
      display_name: (user.display_name as string | null) ?? null,
      transcript_aliases: Array.isArray(user.transcript_aliases) ? user.transcript_aliases as string[] : null,
    }));

    let existingContext: string | null = null;
    const contextParts: string[] = [];
    if (existingItems.milestones.length) {
      contextParts.push("Milestones:\n" + existingItems.milestones.map((m) =>
        `- [${m.id}] "${m.title}" (status: ${m.status}, ${m.percent_complete}% complete, budget: ${m.budget ?? "N/A"})`
      ).join("\n"));
    }
    if (existingItems.tasks.length) {
      const tasks = existingItems.tasks.filter((t) => t.item_type === "task" || !t.item_type);
      const issues = existingItems.tasks.filter((t) => t.item_type === "issue");
      if (tasks.length) {
        contextParts.push("Tasks:\n" + tasks.map((t) =>
          `- [${t.id}] "${t.title}" (status: ${t.status})`
        ).join("\n"));
      }
      if (issues.length) {
        contextParts.push("Issues:\n" + issues.map((t) =>
          `- [${t.id}] "${t.title}" (status: ${t.status})`
        ).join("\n"));
      }
    }
    if (contextParts.length) {
      existingContext = contextParts.join("\n\n");
    }

    const parsed = await parseTranscript(rawContent, {
      flexiblePrompt,
      transcriptType,
      existingContext,
    });
    const newMembers = filterUnknownNewMembers(parsed.new_members, existingUsers);

    let lastMessageAt: string | null = null;
    if (parsed.last_message_at) {
      const d = new Date(parsed.last_message_at);
      lastMessageAt = isNaN(d.getTime()) ? null : d.toISOString();
    }

    const { data: upload, error: uploadErr } = await supabase
      .from("conversation_uploads")
      .insert({
        department_id: departmentId,
        uploaded_by: caller.user_id !== "admin-api" ? caller.user_id : null,
        filename: file.name,
        group_name: parsed.group_name,
        raw_content: rawContent,
        parsed_at: new Date().toISOString(),
        last_message_at: lastMessageAt,
        parsed_new_members: newMembers,
        transcript_type: transcriptType,
      })
      .select("id")
      .single();

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const events = parsed.events.map((event) => {
      const review = buildEventReview(event, existingItems);
      let ts: string | null = null;
      if (event.message_timestamp) {
        const d = new Date(event.message_timestamp);
        ts = isNaN(d.getTime()) ? null : d.toISOString();
      }
      return {
        upload_id: upload.id,
        department_id: departmentId,
        event_type: event.event_type,
        item_type: event.item_type ?? "task",
        task_id: review.review_action === "update" && review.review_kind !== "milestone" ? review.target_id : null,
        milestone_id: review.review_action === "update" && review.review_kind === "milestone" ? review.target_id : null,
        sender_alias: event.sender_alias,
        message_text: event.message_text,
        message_timestamp: ts,
        ai_summary: event.ai_summary,
        task_title: event.task_title,
        milestone_title: event.milestone_title,
        assigned_to_alias: event.assigned_to_alias,
        priority: event.priority,
        confidence: event.confidence,
        percent_complete: event.percent_complete,
        budget: event.budget,
        notes: event.notes,
        description: event.description,
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

    const { data: savedEvents, error: savedEventsErr } = await supabase
      .from("conversation_events")
      .select("id, upload_id, department_id, event_type, item_type, task_id, milestone_id, sender_alias, message_text, message_timestamp, ai_summary, task_title, milestone_title, assigned_to_alias, priority, confidence, percent_complete, budget, notes, description, applied")
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
      events: addReviewFieldsToEvents(savedEvents ?? [], existingItems),
      new_members: newMembers,
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
