import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { AUDIENCE_KEYS, enrichFieldsByPhone, WINDOW_FILTERS } from "@/lib/whatsapp/audience";
import { parseAudienceCsv } from "@/lib/whatsapp/audience-csv";
import { validateRules, type RuleGroup } from "@/lib/whatsapp/audience-filter";
import { getAccountByPhoneNumberId } from "@/lib/whatsapp/accounts";
import { createBroadcast, drainUntilEmpty } from "@/lib/whatsapp/broadcast";
import type { VariableBindings } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z
  .object({
    // "template" broadcasts an approved template; "text" broadcasts a plain free-text message.
    message_kind: z.enum(["template", "text"]).optional(),
    template_code: z.string().min(1).optional(),
    template_language: z.string().optional(),
    text: z.string().min(1).optional(), // free-text body when message_kind === "text"
    // WhatsApp account/number to send from (phoneNumberId). Determines the sending number for free-text
    // and is validated against the template's owning WABA for template sends.
    phone_number_id: z.string().optional(),
    audience_key: z.enum(AUDIENCE_KEYS),
    selected_user_ids: z.array(z.string().uuid()).optional(),
    rules: z.any().optional(), // react-querybuilder tree for the "custom" audience
    csv: z.string().optional(), // raw CSV text for the "csv_upload" audience (audience-export format)
    window: z.enum(WINDOW_FILTERS).optional(), // restrict to free (in_window) / paid (out_window)
    window_hours: z.number().positive().optional(), // override the free-window size (hours)
    variable_bindings: z.any().optional(),
  })
  .superRefine((data, ctx) => {
    const kind = data.message_kind ?? "template";
    if (kind === "template" && !data.template_code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "template_code is required for a template send.", path: ["template_code"] });
    }
    if (kind === "text") {
      if (!data.text) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "text is required for a free-text send.", path: ["text"] });
      if (!data.phone_number_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phone_number_id is required for a free-text send.", path: ["phone_number_id"] });
    }
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

  // Resolve the sending account from the chosen number, if one was passed. An unknown id is a 400
  // rather than a silent fall-back to primary, so a stale UI can't misroute a send.
  let account;
  if (parsed.data.phone_number_id) {
    account = getAccountByPhoneNumberId(parsed.data.phone_number_id);
    if (!account) return NextResponse.json({ error: "Unknown WhatsApp account." }, { status: 400 });
  }

  const messageKind = parsed.data.message_kind ?? "template";
  const triggeredByUserId = auth.caller.user_id === "admin-api" ? null : auth.caller.user_id;
  const result = await createBroadcast({
    messageKind,
    templateCode: parsed.data.template_code,
    templateLanguage: parsed.data.template_language,
    text: parsed.data.text,
    audienceKey: parsed.data.audience_key,
    selectedUserIds: parsed.data.selected_user_ids ?? [],
    rules,
    windowFilter: parsed.data.window ?? "all",
    windowHours: parsed.data.window_hours,
    recipients: csvRecipients,
    variableBindings: parsed.data.variable_bindings as VariableBindings | undefined,
    account,
    triggeredByUserId,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Drain inline until the queue is empty (bounded); the cron is a backstop, not a dependency, so small/
  // medium broadcasts complete in this request instead of hanging in 'running' if the cron isn't firing.
  after(() => drainUntilEmpty().catch((err) => console.error("Initial broadcast drain failed:", err)));

  return NextResponse.json({ status: "started", ...result });
}
