import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { getDefaultPromptText } from "@/lib/agent/prompts";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_read_all && !canManageKnowledge(caller.portal)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { key } = await params;
    const defaultText = getDefaultPromptText(key);

    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("system_prompts")
      .select("prompt_text, updated_by, updated_at")
      .eq("prompt_key", key)
      .maybeSingle();

    return NextResponse.json({
      prompt_key: key,
      prompt_text: data?.prompt_text || defaultText,
      is_default: !data?.prompt_text,
      default_text: defaultText,
      updated_by: data?.updated_by ?? null,
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
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_write_all && !canManageKnowledge(caller.portal)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { key } = await params;
    const body = (await req.json()) as { prompt_text?: unknown };
    const promptText = typeof body.prompt_text === "string" ? body.prompt_text : "";

    if (promptText.length > 10000) {
      return NextResponse.json({ error: "prompt_text must be 10000 characters or fewer" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("system_prompts")
      .upsert(
        {
          prompt_key: key,
          prompt_text: promptText,
          updated_by: caller.user_id !== "admin-api" ? caller.user_id : null,
        },
        { onConflict: "prompt_key" },
      )
      .select("prompt_key, prompt_text, updated_at")
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
