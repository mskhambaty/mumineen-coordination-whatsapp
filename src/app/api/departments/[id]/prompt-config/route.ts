import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, guardWriteAccess, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getDefaultFlexiblePrompt } from "@/lib/transcripts/prompts";

type PromptConfigBody = {
  flexible_prompt?: unknown;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;
    guardWriteAccess(caller, id);

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
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      fixed_prompt_locked: true,
      flexible_prompt: data?.flexible_prompt || getDefaultFlexiblePrompt(department?.name),
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

    if (flexiblePrompt.length > 4000) {
      return NextResponse.json({ error: "flexible_prompt must be 4000 characters or fewer" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("department_prompt_config")
      .upsert(
        {
          department_id: id,
          flexible_prompt: flexiblePrompt,
          updated_by: caller.user_id !== "admin-api" ? caller.user_id : null,
        },
        { onConflict: "department_id" },
      )
      .select("flexible_prompt, updated_at")
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
