import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { isRegistrationGateEnabled, setRegistrationGateEnabled } from "@/lib/mumineen/registration";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

// GET: current state of the WhatsApp registration gate.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ enabled: await isRegistrationGateEnabled() });
}

// POST { enabled: boolean }: flip the gate on/off live (no redeploy).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Body must include { enabled: boolean }." }, { status: 400 });
  }
  await setRegistrationGateEnabled(body.enabled);
  return NextResponse.json({ enabled: body.enabled });
}
