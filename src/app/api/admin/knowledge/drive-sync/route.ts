import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { syncDriveFaqFolder } from "@/lib/knowledge/drive-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/admin/knowledge/drive-sync — manual "Sync now" trigger for the
// Drive FAQ folder, callable from the admin Knowledge page.
// Pass ?dryRun=true to preview the plan (added/updated/skipped/deleted) without
// downloading, embedding, or writing anything.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true";
  try {
    const stats = await syncDriveFaqFolder({ dryRun });
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
