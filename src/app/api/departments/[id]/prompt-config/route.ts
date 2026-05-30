import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, guardWriteAccess, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getDefaultFlexiblePrompt } from "@/lib/transcripts/prompts";

type PromptConfigBody = {
  flexible_prompt?: unknown;
  transcript_type?: unknown;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;
    guardWriteAccess(caller, id);

    const transcriptType = req.nextUrl.searchParams.get("transcript_type") ?? "whatsapp";

    const supabase = getSupabaseAdmin();
    const { data: department } = await supabase
      .from("departments")
      .select("name")
      .eq("id", id)
      .single();

    const { data, error } = await supabase
      .from("department_prompt_config")
      .select("flexible_prompt, updated_at")
      .eq("department_id", id)
      .eq("transcript_type", transcriptType)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      fixed_prompt_locked: true,
      flexible_prompt: data?.flexible_prompt || getDefaultFlexiblePrompt(department?.name),
      transcript_type: transcriptType,
      updated_at: data?.updated_at ?? null,
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
    guardWriteAccess(caller, id);

    const body = (await req.json()) as PromptConfigBody;
    const flexiblePrompt = typeof body.flexible_prompt === "string" ? body.flexible_prompt : "";
    const transcriptType = typeof body.transcript_type === "string" && (body.transcript_type === "whatsapp" || body.transcript_type === "meeting")
      ? body.transcript_type
      : "whatsapp";

    if (flexiblePrompt.length > 4000) {
      return NextResponse.json({ error: "flexible_prompt must be 4000 characters or fewer" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("department_prompt_config")
      .upsert(
        {
          department_id: id,
          transcript_type: transcriptType,
          flexible_prompt: flexiblePrompt,
          updated_by: caller.user_id !== "admin-api" ? caller.user_id : null,
        },
        { onConflict: "department_id,transcript_type" },
      )
      .select("flexible_prompt, transcript_type, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
