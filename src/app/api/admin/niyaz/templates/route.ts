import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { listMessageTemplates, type WaTemplate, type WaTemplateComponent } from "@/lib/meta/whatsapp";
import { getBroadcastAccount, getPrimaryAccount } from "@/lib/whatsapp/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function find(components: WaTemplateComponent[] | undefined, type: string): WaTemplateComponent | undefined {
  return (components ?? []).find((c) => c.type?.toUpperCase() === type);
}

// A preview shape for one template: the body/header text and button labels, so the composer can
// render a live preview (substituting the day's config values into the body variables).
function toPreview(t: WaTemplate) {
  const header = find(t.components, "HEADER");
  const body = find(t.components, "BODY");
  const footer = find(t.components, "FOOTER");
  const buttons = find(t.components, "BUTTONS");
  return {
    name: t.name,
    language: t.language,
    bodyText: body?.text ?? null,
    footerText: footer?.text ?? null,
    header: header ? { format: (header.format ?? "TEXT").toUpperCase(), text: header.text ?? null } : null,
    buttons: (buttons?.buttons ?? []).map((b) => ({ type: (b.type ?? "").toUpperCase(), text: b.text ?? null })),
  };
}

// GET — approved templates from the niyaz RSVP number's WABA (the broadcast account, 630 763 8963),
// for the Niyaz days template dropdown + live preview. Falls back to the primary account only if no
// broadcast account is configured (single-number deployments).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const account = getBroadcastAccount() ?? getPrimaryAccount();
  try {
    const templates = await listMessageTemplates(account);
    const approved = templates
      .filter((t) => t.status?.toUpperCase() === "APPROVED")
      .map(toPreview)
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ templates: approved, account: account.displayNumber ?? account.label });
  } catch (err) {
    return NextResponse.json({ templates: [], error: err instanceof Error ? err.message : "Failed to load templates" });
  }
}
