import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { ALWAYS_ON_RULES, SYSTEM_PROMPT } from "@/lib/agent/run-agent";

// GET: the always-on rule blocks appended to every system prompt (code-managed, read-only).
// Lets admins see the full effective prompt, not just the editable base.
export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_read_all) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({
      rules: ALWAYS_ON_RULES,
      // Dynamic, per-message context that's also injected but varies each turn.
      dynamic: ["Current Site Information (RAG)", "Sender Context (phone, role, access)", "Available Departments"],
      base_default: SYSTEM_PROMPT,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
