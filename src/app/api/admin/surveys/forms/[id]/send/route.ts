import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { commitAndSendForm } from "@/lib/surveys/send";

export const runtime = "nodejs";

// POST /api/admin/surveys/forms/[id]/send — commit the sample (creates tokens + exposures) and
// dispatch the WhatsApp template. Body { template? } selects the template directly (admin dropdown);
// otherwise falls back to the env default. Returns the per-recipient links for manual sending too.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { template?: unknown; freeWindowOnly?: unknown };
  const template = typeof body.template === "string" ? body.template : undefined;
  const freeWindowOnly = body.freeWindowOnly === true;

  const result = await commitAndSendForm(id, template, freeWindowOnly);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
