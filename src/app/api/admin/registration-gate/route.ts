import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { isRegistrationGateEnabled, setRegistrationGateEnabled } from "@/lib/mumineen/registration";

export const runtime = "nodejs";

// GET: current state of the WhatsApp registration gate.
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ enabled: await isRegistrationGateEnabled() });
}

// POST { enabled: boolean }: flip the gate on/off live (no redeploy).
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Body must include { enabled: boolean }." }, { status: 400 });
  }
  await setRegistrationGateEnabled(body.enabled);
  return NextResponse.json({ enabled: body.enabled });
}
