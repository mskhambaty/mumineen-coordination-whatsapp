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
  rules: z.any().optional(),
  csv: z.string().optional(), // raw CSV text for the "csv_upload" audience (audience-export format)
  window: z.enum(WINDOW_FILTERS).optional(), // restrict to free (in_window) / paid (out_window)
  window_hours: z.number().positive().optional(), // override the free-window size (hours)
});

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// POST /api/admin/templates/audience-export — full audience as a CSV download (the preview list is
// capped, so this gives every matched recipient with basic details). Admin/leadership only.
//
// For csv_upload we export the *resolved* audience — the uploaded rows deduped by number, enriched
// from the roster by phone (Name/ITS/… filled where blank), and labelled free/paid — which is what
// will actually be messaged, not the raw file the user already has.
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
  if (parsed.data.audience_key === "csv_upload") {
    if (!parsed.data.csv) return NextResponse.json({ error: "Upload a CSV file first." }, { status: 400 });
    const csv = parseAudienceCsv(parsed.data.csv);
    if (csv.error) return NextResponse.json({ error: csv.error }, { status: 400 });
    // Same enrichment the preview/send paths apply, so the export carries roster Name/ITS for rows
    // that left them blank (CSV-provided values still win).
    await enrichFieldsByPhone(csv.recipients);
    preview = await previewExplicitRecipients(csv.recipients, window, windowHours);
  } else {
    preview = await previewAudience(parsed.data.audience_key, parsed.data.selected_user_ids ?? [], rules, window, windowHours);
  }

  const header = ["Name", "ITS", "HOF ITS", "Jamaat", "City", "Gender", "Local/Mehman", "WhatsApp", "Window"];
  const lines = [header.map(esc).join(",")];
  for (const r of preview.recipients) {
    const f = r.fields ?? {};
    lines.push(
      [f.full_name, f.its, f.hof_its, f.jamaat, f.city, f.gender, f.local_mehman, r.phone, r.inWindow ? "free" : "paid"].map(esc).join(","),
    );
  }
  // Prepend a BOM so Excel reads UTF-8 names correctly.
  const csv = "﻿" + lines.join("\r\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audience-${parsed.data.audience_key}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
