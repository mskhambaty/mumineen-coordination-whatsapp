import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/admin/session-token";

// Explicitly public: logging out must not require a valid session.
export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", sessionCookieOptions(0));
  return NextResponse.json({ ok: true });
}
