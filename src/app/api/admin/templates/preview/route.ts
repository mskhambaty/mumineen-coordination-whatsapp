import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminLeadership } from "@/lib/api/auth";
import { AUDIENCE_KEYS, previewAudience } from "@/lib/whatsapp/audience";

export const runtime = "nodejs";

const schema = z.object({
  audience_key: z.enum(AUDIENCE_KEYS),
  selected_user_ids: z.array(z.string().uuid()).optional(),
});

// POST /api/admin/templates/preview — resolve an audience to free/paid counts + estimated cost so
// the console can show the impact before sending. Returns counts only — never the phone list.
export async function POST(req: NextRequest) {
  if (!(await requireAdminLeadership(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const preview = await previewAudience(parsed.data.audience_key, parsed.data.selected_user_ids ?? []);
  return NextResponse.json({
    total: preview.total,
    in_window: preview.in_window,
    out_window: preview.out_window,
    est_cost_usd: preview.est_cost_usd,
  });
}
