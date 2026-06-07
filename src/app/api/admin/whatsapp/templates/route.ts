import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { listMessageTemplates } from "@/lib/meta/whatsapp";
import { describeTemplate } from "@/lib/whatsapp/templates";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

// GET /api/admin/whatsapp/templates — approved message templates (live from Meta), described for
// the composer (body variables, header, dynamic URL buttons).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  try {
    const all = await listMessageTemplates();
    const templates = all.filter((t) => t.status?.toUpperCase() === "APPROVED").map(describeTemplate);
    return NextResponse.json({ templates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load templates" }, { status: 502 });
  }
}
