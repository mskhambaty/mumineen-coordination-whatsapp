import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { AUDIENCE_KEYS } from "@/lib/whatsapp/audience";
import { validateRules, type RuleGroup } from "@/lib/whatsapp/audience-filter";
import { createBroadcast, drainBroadcasts } from "@/lib/whatsapp/broadcast";
import type { VariableBindings } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";

const schema = z.object({
  template_code: z.string().min(1),
  template_language: z.string().optional(),
  audience_key: z.enum(AUDIENCE_KEYS),
  selected_user_ids: z.array(z.string().uuid()).optional(),
  rules: z.any().optional(), // react-querybuilder tree for the "custom" audience
  variable_bindings: z.any().optional(),
});

// POST /api/admin/templates/send — create a broadcast (enqueues all recipients) and kick off the
// first drain batch immediately; a cron drains the rest in throttled batches. Manual, admin/
// leadership only — no auto-scheduling. Returns the broadcast id so the console can poll progress.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const rules = parsed.data.rules as RuleGroup | undefined;
  if (parsed.data.audience_key === "custom") {
    if (!rules) return NextResponse.json({ error: "Custom audience needs filter rules." }, { status: 400 });
    const err = validateRules(rules);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const triggeredByUserId = auth.caller.user_id === "admin-api" ? null : auth.caller.user_id;
  const result = await createBroadcast({
    templateCode: parsed.data.template_code,
    templateLanguage: parsed.data.template_language,
    audienceKey: parsed.data.audience_key,
    selectedUserIds: parsed.data.selected_user_ids ?? [],
    rules,
    variableBindings: parsed.data.variable_bindings as VariableBindings | undefined,
    triggeredByUserId,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Send the first batch right away; the cron handles the remainder.
  after(() => drainBroadcasts().catch((err) => console.error("Initial broadcast drain failed:", err)));

  return NextResponse.json({ status: "started", ...result });
}
