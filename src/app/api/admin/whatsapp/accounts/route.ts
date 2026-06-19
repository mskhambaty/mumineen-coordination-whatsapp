import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { accountDisplayName, getAccounts } from "@/lib/whatsapp/accounts";

export const runtime = "nodejs";

// GET /api/admin/whatsapp/accounts — list the configured WhatsApp sending numbers for the send
// console's "Send from" picker. Admin/leadership only. Returns NO secrets (no access token, app
// secret, or verify token) — only the non-PII routing id + display labels.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const accounts = getAccounts().map((a) => ({
    label: a.label,
    name: accountDisplayName(a),
    displayName: a.displayName ?? null,
    displayNumber: a.displayNumber ?? null,
    phoneNumberId: a.phoneNumberId,
  }));

  return NextResponse.json({ accounts });
}
