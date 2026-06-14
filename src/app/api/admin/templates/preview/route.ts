import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { AUDIENCE_KEYS, enrichFieldsByPhone, previewAudience, previewExplicitRecipients, WINDOW_FILTERS, type AudiencePreview } from "@/lib/whatsapp/audience";
import { parseAudienceCsv } from "@/lib/whatsapp/audience-csv";
import { validateRules, type RuleGroup } from "@/lib/whatsapp/audience-filter";

export const runtime = "nodejs";

const schema = z.object({
  audience_key: z.enum(AUDIENCE_KEYS),
  selected_user_ids: z.array(z.string().uuid()).optional(),
  rules: z.any().optional(), // react-querybuilder tree for the "custom" audience
  csv: z.string().optional(), // raw CSV text for the "csv_upload" audience (audience-export format)
  window: z.enum(WINDOW_FILTERS).optional(), // restrict to free (in_window) / paid (out_window)
  window_hours: z.number().positive().max(24).optional(), // override the free-window size (hours)
  include_recipients: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

// POST /api/admin/templates/preview — resolve an audience to free/paid counts + estimated cost, and
// (admin-only, when include_recipients) a paginated recipient list, so the console can show impact
// and who will receive it before sending.
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

  const window = parsed.data.window ?? "all";
  const windowHours = parsed.data.window_hours;
  let preview: AudiencePreview;
  let csvStats: { parsed: number; skipped: number; duplicates: number; corrupted: number } | null = null;
  if (parsed.data.audience_key === "csv_upload") {
    if (!parsed.data.csv) return NextResponse.json({ error: "Upload a CSV file first." }, { status: 400 });
    const csv = parseAudienceCsv(parsed.data.csv);
    if (csv.error) return NextResponse.json({ error: csv.error }, { status: 400 });
    // Fill missing Name/ITS/etc. from the roster by phone so personalization resolves even when the
    // uploaded row left them blank (e.g. a failures CSV); CSV-provided values still win.
    await enrichFieldsByPhone(csv.recipients);
    preview = await previewExplicitRecipients(csv.recipients, window, windowHours);
    csvStats = { parsed: csv.parsed, skipped: csv.skipped, duplicates: csv.duplicates, corrupted: csv.corrupted };
  } else {
    preview = await previewAudience(parsed.data.audience_key, parsed.data.selected_user_ids ?? [], rules, window, windowHours);
  }

  const body: Record<string, unknown> = {
    total: preview.total,
    in_window: preview.in_window,
    out_window: preview.out_window,
    est_cost_usd: preview.est_cost_usd,
    funnel: preview.funnel ?? null,
    csv_stats: csvStats,
  };

  if (parsed.data.include_recipients) {
    const limit = parsed.data.limit ?? 50;
    const offset = parsed.data.offset ?? 0;
    body.recipients = preview.recipients.slice(offset, offset + limit).map((r) => ({
      phone: r.phone,
      full_name: r.fields?.full_name ?? null,
      its: r.fields?.its ?? null,
      inWindow: r.inWindow,
    }));
  }

  return NextResponse.json(body);
}
