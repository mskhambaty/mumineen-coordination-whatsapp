import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { AUDIENCE_KEYS, enrichFieldsByPhone } from "@/lib/whatsapp/audience";
import { parseAudienceCsv } from "@/lib/whatsapp/audience-csv";
import { validateRules, type RuleGroup } from "@/lib/whatsapp/audience-filter";
import { createBroadcast, drainBroadcasts } from "@/lib/whatsapp/broadcast";
import type { VariableBindings } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  template_code: z.string().min(1),
  template_language: z.string().optional(),
  audience_key: z.enum(AUDIENCE_KEYS),
  selected_user_ids: z.array(z.string().uuid()).optional(),
  rules: z.any().optional(), // react-querybuilder tree for the "custom" audience
  csv: z.string().optional(), // raw CSV text for the "csv_upload" audience (audience-export format)
  variable_bindings: z.any().optional(),
  // Per-broadcast send throttle (anti-spam pacing). Omitted → env/default pacing at drain time.
  batch_size: z.number().int().min(1).max(150).optional(),
  send_interval_ms: z.number().int().min(0).max(60000).optional(),
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

  // csv_upload: parse the uploaded file into an explicit recipient list (audience resolution is
  // skipped). Same format the app's CSV downloads use; mapped columns become personalization fields.
  let csvRecipients: Awaited<ReturnType<typeof parseAudienceCsv>>["recipients"] | undefined;
  if (parsed.data.audience_key === "csv_upload") {
    if (!parsed.data.csv) return NextResponse.json({ error: "Upload a CSV file first." }, { status: 400 });
    const csv = parseAudienceCsv(parsed.data.csv);
    if (csv.error) return NextResponse.json({ error: csv.error }, { status: 400 });
    if (csv.recipients.length === 0) return NextResponse.json({ error: "No valid recipients in the CSV (need a WhatsApp column with usable numbers)." }, { status: 400 });
    // Fill missing Name/ITS/etc. from the roster by phone so personalized templates resolve; CSV wins.
    await enrichFieldsByPhone(csv.recipients);
    csvRecipients = csv.recipients;
  }

  const triggeredByUserId = auth.caller.user_id === "admin-api" ? null : auth.caller.user_id;
  const result = await createBroadcast({
    templateCode: parsed.data.template_code,
    templateLanguage: parsed.data.template_language,
    audienceKey: parsed.data.audience_key,
    selectedUserIds: parsed.data.selected_user_ids ?? [],
    rules,
    recipients: csvRecipients,
    variableBindings: parsed.data.variable_bindings as VariableBindings | undefined,
    triggeredByUserId,
    batchSize: parsed.data.batch_size ?? null,
    sendIntervalMs: parsed.data.send_interval_ms ?? null,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Kick a single paced batch inline for immediacy; the every-minute cron paces the rest. We no longer
  // drain-until-empty here — that would blast the whole broadcast out at once and trip Meta's spam rate
  // limit (131048). Pacing (batch size + per-send delay) is honored by drainBroadcasts.
  after(() => drainBroadcasts().catch((err) => console.error("Initial broadcast drain failed:", err)));

  return NextResponse.json({ status: "started", ...result });
}
