import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { commitAndSendForm } from "@/lib/surveys/send";

export const runtime = "nodejs";

// POST /api/admin/surveys/forms/[id]/send — commit the sample (creates tokens + exposures) and,
// if SURVEY_SEND_ENABLED, dispatch the WhatsApp template. Returns the per-recipient links so they
// can be exported/sent manually until the template is live.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const result = await commitAndSendForm(id);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
