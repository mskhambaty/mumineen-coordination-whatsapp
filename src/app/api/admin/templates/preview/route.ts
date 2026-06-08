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
  rules: z.any().optional(), // react-querybuilder tree for the "custom" audience
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

  const preview = await previewAudience(parsed.data.audience_key, parsed.data.selected_user_ids ?? [], rules);

  const body: Record<string, unknown> = {
    total: preview.total,
    in_window: preview.in_window,
    out_window: preview.out_window,
    est_cost_usd: preview.est_cost_usd,
    funnel: preview.funnel ?? null,
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
