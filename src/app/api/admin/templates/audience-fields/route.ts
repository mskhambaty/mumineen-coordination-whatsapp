import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { FIELD_CATALOG, OPS_BY_TYPE, dynamicEnumValues } from "@/lib/whatsapp/audience-filter";
import { MAPPABLE_FIELDS } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";

// GET /api/admin/templates/audience-fields — filter field catalog (operators + enum options) for the
// custom-audience builder, plus the roster fields available for per-recipient variable mapping.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  let dynamic: Record<string, string[]> = {};
  try {
    dynamic = await dynamicEnumValues();
  } catch {
    dynamic = {};
  }

  const fields = FIELD_CATALOG.map((f) => ({
    key: f.key,
    label: f.label,
    group: f.group,
    type: f.type,
    operators: OPS_BY_TYPE[f.type],
    values: f.dynamicEnum ? (dynamic[f.key] ?? []) : (f.enumValues ?? []),
  }));

  return NextResponse.json({ fields, mappableFields: MAPPABLE_FIELDS });
}
