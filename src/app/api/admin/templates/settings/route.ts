import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getAccountByWaba } from "@/lib/whatsapp/accounts";
import { upsertTemplateSetting } from "@/lib/whatsapp/template-settings";

export const runtime = "nodejs";

const schema = z
  .object({
    template_name: z.string().min(1),
    // WABA that owns the template. Omitted = the primary account (back-compat with the existing UI).
    waba_id: z.string().min(1).optional(),
    friendly_name: z.string().max(120).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => v.friendly_name !== undefined || v.is_active !== undefined, {
    message: "Provide friendly_name and/or is_active.",
  });

// PUT /api/admin/templates/settings — set a template's friendly name and/or active flag for the
// Send Templates console. Admin/leadership only. Annotates Meta templates; never creates them.
export async function PUT(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const { template_name, waba_id, friendly_name, is_active } = parsed.data;

  // Resolve which account's WABA this annotation belongs to. Omitted waba_id = primary account.
  const account = waba_id ? getAccountByWaba(waba_id) : undefined;
  if (waba_id && !account) {
    return NextResponse.json({ error: "Unknown waba_id" }, { status: 400 });
  }

  const saved = await upsertTemplateSetting(account, template_name, {
    friendlyName: friendly_name,
    isActive: is_active,
  });

  return NextResponse.json({ template_name, friendlyName: saved.friendlyName, isActive: saved.isActive });
}
