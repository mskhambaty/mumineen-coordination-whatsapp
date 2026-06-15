import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { listMessageTemplates } from "@/lib/meta/whatsapp";
import { getBroadcastAccount, getPrimaryAccount } from "@/lib/whatsapp/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — approved templates from the niyaz RSVP number's WABA (the broadcast account, 630 763 8963),
// for the Niyaz days template dropdown. Falls back to the primary account only if no broadcast
// account is configured (single-number deployments).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const account = getBroadcastAccount() ?? getPrimaryAccount();
  try {
    const templates = await listMessageTemplates(account);
    const approved = templates
      .filter((t) => t.status?.toUpperCase() === "APPROVED")
      .map((t) => ({ name: t.name, language: t.language }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ templates: approved, account: account.displayNumber ?? account.label });
  } catch (err) {
    return NextResponse.json({ templates: [], error: err instanceof Error ? err.message : "Failed to load templates" });
  }
}
