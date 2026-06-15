import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { listApprovedTemplatesForAllAccounts } from "@/lib/whatsapp/send-template";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

// GET /api/admin/whatsapp/templates — approved message templates across all WhatsApp accounts (live
// from Meta), described for the composer (body variables, header, dynamic URL buttons). Each template
// is tagged with the account/WABA/number that owns it, so the composer can show and pick the sending
// number (the template determines which number it goes out from).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  try {
    const templates = await listApprovedTemplatesForAllAccounts();
    return NextResponse.json({ templates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load templates" }, { status: 502 });
  }
}
