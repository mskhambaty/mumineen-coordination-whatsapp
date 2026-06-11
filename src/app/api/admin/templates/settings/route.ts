import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { upsertTemplateSetting } from "@/lib/whatsapp/template-settings";

export const runtime = "nodejs";

const schema = z
  .object({
    template_name: z.string().min(1),
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

  const { template_name, friendly_name, is_active } = parsed.data;
  const saved = await upsertTemplateSetting(template_name, {
    friendlyName: friendly_name,
    isActive: is_active,
  });

  return NextResponse.json({ template_name, friendlyName: saved.friendlyName, isActive: saved.isActive });
}
