import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { ALWAYS_ON_RULES, SYSTEM_PROMPT } from "@/lib/agent/run-agent";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET: the always-on rule blocks appended to every system prompt.
// Returns each rule with its current text (DB override or code default), default text,
// and whether it's been customized.
export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_read_all && !canManageKnowledge(caller.portal)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();
    const keys = ALWAYS_ON_RULES.map((r) => `rule_${r.name}`);
    const { data: overrides } = await supabase
      .from("system_prompts")
      .select("prompt_key, prompt_text, updated_by, updated_at")
      .in("prompt_key", keys);

    const overrideMap = new Map(
      (overrides ?? []).map((o) => [o.prompt_key.replace(/^rule_/, ""), o]),
    );

    const rules = ALWAYS_ON_RULES.map((rule) => {
      const override = overrideMap.get(rule.name);
      return {
        name: rule.name,
        label: rule.label,
        text: override?.prompt_text || rule.text,
        default_text: rule.text,
        is_default: !override?.prompt_text,
        updated_by: override?.updated_by ?? null,
        updated_at: override?.updated_at ?? null,
      };
    });

    return NextResponse.json({
      rules,
      dynamic: ["Current Site Information (RAG)", "Sender Context (phone, role, access, registration profile)", "Available Departments"],
      base_default: SYSTEM_PROMPT,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

// PUT: save an override for a specific rule. Body: { name: string, text: string }
// Passing empty text or omitting it resets to default (deletes the override).
export async function PUT(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_write_all && !canManageKnowledge(caller.portal)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { name?: unknown; text?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    const text = typeof body.text === "string" ? body.text : "";

    const rule = ALWAYS_ON_RULES.find((r) => r.name === name);
    if (!rule) {
      return NextResponse.json({ error: `Unknown rule: ${name}` }, { status: 400 });
    }

    if (text.length > 15000) {
      return NextResponse.json({ error: "Rule text must be 15000 characters or fewer" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const key = `rule_${name}`;

    if (!text || text.trim() === rule.text.trim()) {
      // Reset to default: delete the override
      await supabase.from("system_prompts").delete().eq("prompt_key", key);
      return NextResponse.json({ name, text: rule.text, is_default: true });
    }

    const { error } = await supabase
      .from("system_prompts")
      .upsert(
        { prompt_key: key, prompt_text: text, updated_by: caller.user_id !== "admin-api" ? caller.user_id : null },
        { onConflict: "prompt_key" },
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ name, text, is_default: false });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
