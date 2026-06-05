import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { listMessageTemplates } from "@/lib/meta/whatsapp";
import { describeTemplate } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";

// GET /api/admin/whatsapp/templates — approved message templates (live from Meta), described for
// the composer (body variables, header, dynamic URL buttons).
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const all = await listMessageTemplates();
    const templates = all.filter((t) => t.status?.toUpperCase() === "APPROVED").map(describeTemplate);
    return NextResponse.json({ templates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load templates" }, { status: 502 });
  }
}
