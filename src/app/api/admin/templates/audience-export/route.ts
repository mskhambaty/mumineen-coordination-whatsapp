import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { AUDIENCE_KEYS, previewAudience } from "@/lib/whatsapp/audience";
import { validateRules, type RuleGroup } from "@/lib/whatsapp/audience-filter";

export const runtime = "nodejs";

const schema = z.object({
  audience_key: z.enum(AUDIENCE_KEYS),
  selected_user_ids: z.array(z.string().uuid()).optional(),
  rules: z.any().optional(),
});

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// POST /api/admin/templates/audience-export — full audience as a CSV download (the preview list is
// capped, so this gives every matched recipient with basic details). Admin/leadership only.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.audience_key === "csv_upload") {
    return NextResponse.json({ error: "Export is not available for an uploaded CSV — you already have the file." }, { status: 400 });
  }

  const rules = parsed.data.rules as RuleGroup | undefined;
  if (parsed.data.audience_key === "custom") {
    if (!rules) return NextResponse.json({ error: "Custom audience needs filter rules." }, { status: 400 });
    const err = validateRules(rules);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const preview = await previewAudience(parsed.data.audience_key, parsed.data.selected_user_ids ?? [], rules);

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
