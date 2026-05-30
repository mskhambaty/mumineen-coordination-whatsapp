import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { parseTranscript } from "@/lib/transcripts/parser";
import { getDefaultFlexiblePrompt } from "@/lib/transcripts/prompts";

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);

    // Only pm, hod, or leadership_admin can upload
    if (caller.global_role === "member" && !caller.can_write_all) {
      return NextResponse.json({ error: "Insufficient permissions to upload transcripts" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const departmentId = formData.get("department_id") as string | null;

    if (!file || !departmentId) {
      return NextResponse.json({ error: "file and department_id are required" }, { status: 400 });
    }

    // Verify department access
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

    const { data: promptConfig } = await supabase
      .from("department_prompt_config")
      .select("flexible_prompt")
      .eq("department_id", departmentId)
      .maybeSingle();

    const flexiblePrompt = promptConfig?.flexible_prompt || getDefaultFlexiblePrompt(department?.name);

    // Parse with AI
    const parsed = await parseTranscript(rawContent, flexiblePrompt);

    // Save upload record
    const { data: upload, error: uploadErr } = await supabase
      .from("conversation_uploads")
      .insert({
        department_id: departmentId,
        uploaded_by: caller.user_id !== "admin-api" ? caller.user_id : null,
        filename: file.name,
        group_name: parsed.group_name,
        raw_content: rawContent,
        parsed_at: new Date().toISOString(),
        last_message_at: parsed.last_message_at,
        parsed_new_members: parsed.new_members,
      })
      .select("id")
      .single();

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    // Save parsed events
    const events = parsed.events.map((event) => ({
      upload_id: upload.id,
      department_id: departmentId,
      event_type: event.event_type,
      sender_alias: event.sender_alias,
      message_text: event.message_text,
      message_timestamp: event.message_timestamp,
      ai_summary: event.ai_summary,
      task_title: event.task_title,
      assigned_to_alias: event.assigned_to_alias,
      priority: event.priority,
      confidence: event.confidence,
      applied: false,
    }));

    if (events.length > 0) {
      const { error: eventsErr } = await supabase
        .from("conversation_events")
        .insert(events);

      if (eventsErr) {
        console.error("Failed to insert conversation events:", eventsErr);
      }
    }

    // Fetch saved events with IDs
    const { data: savedEvents } = await supabase
      .from("conversation_events")
      .select("id, event_type, sender_alias, message_text, message_timestamp, ai_summary, task_title, assigned_to_alias, priority, confidence, applied")
      .eq("upload_id", upload.id)
      .order("message_timestamp", { ascending: true });

    return NextResponse.json({
      upload_id: upload.id,
      group_name: parsed.group_name,
      events: savedEvents ?? [],
      new_members: parsed.new_members,
      flexible_prompt: flexiblePrompt,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
