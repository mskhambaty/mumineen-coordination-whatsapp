import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey, resolveCallerFromPhone } from "@/lib/api/auth";
import { getSenderProfile, toPublicSenderProfile } from "@/lib/mumineen/sender-profile";

type RouteContext = {
  params: Promise<{ phoneE164: string }>;
};

// Internal-only: the inbox "User Profile" panel. Returns the sender's registration
// profile with PII stripped (no age, phone, email, or ITS) plus their committee
// department assignments. Admin-key gated like the rest of /api/admin/conversations.
export async function GET(req: NextRequest, { params }: RouteContext) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);

  const [profile, caller] = await Promise.all([
    getSenderProfile(phone).catch(() => null),
    resolveCallerFromPhone(phone).catch(() => undefined),
  ]);

  const departments = (caller?.departments ?? []).map((d) => ({
    name: d.department_name,
    role: d.dept_role,
  }));

  return NextResponse.json({
    profile: profile ? toPublicSenderProfile(profile) : null,
    global_role: caller?.global_role ?? null,
    departments,
  });
}
