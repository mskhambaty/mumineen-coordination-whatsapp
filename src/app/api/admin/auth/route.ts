import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { emailMatchPattern } from "@/lib/admin/email";
import { verifyPassword } from "@/lib/admin/passwords";
import { buildPortalSessionUser } from "@/lib/admin/session";
import { SESSION_COOKIE_NAME, sessionCookieOptions, signSessionToken } from "@/lib/admin/session-token";
import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Look up the user case-insensitively: stored emails may be mixed-case, and
    // an exact match would lock those members out of sign-in entirely.
    const emailPattern = emailMatchPattern(email);
    let { data: user, error } = await supabase
      .from("whatsapp_users")
      .select("id, display_name, email, global_role, role, is_helpdesk, password_hash")
      .ilike("email", emailPattern)
      .maybeSingle();

    if (error?.message.includes("password_hash")) {
      const fallbackResult = await supabase
        .from("whatsapp_users")
        .select("id, display_name, email, global_role, role, is_helpdesk")
        .ilike("email", emailPattern)
        .maybeSingle();
      user = fallbackResult.data ? { ...fallbackResult.data, password_hash: null } : null;
      error = fallbackResult.error;
    }

    if (error) {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const sessionUser = await buildPortalSessionUser({
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      global_role: user.global_role,
    });

    // Any non-visitor portal user may sign in, including those not yet assigned
    // to a department. Visitors (the public/mumineen) are rejected.
    if (!canAccessPortal(sessionUser)) {
      return NextResponse.json({ error: "Access denied. Internal team access required." }, { status: 403 });
    }

    const passwordHash = typeof user.password_hash === "string" ? user.password_hash : null;
    const legacyPassword = optionalEnv("ADMIN_FALLBACK_PASSWORD");
    const validPassword = passwordHash
      ? await verifyPassword(password, passwordHash)
      : Boolean(legacyPassword && password === legacyPassword);

    if (!validPassword) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Stamp last login. Best-effort: never block sign-in if this fails (e.g.
    // the column hasn't been migrated yet on an older database).
    await supabase
      .from("whatsapp_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id)
      .then(undefined, (err) => {
        console.error("Failed to stamp last_login_at", err);
      });

    // Issue a signed httpOnly session cookie; permissions are re-resolved per request.
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, signSessionToken(user.id), sessionCookieOptions());

    return NextResponse.json({ user: sessionUser });
  } catch (error) {
    console.error("Admin login failed", error);
    if (error instanceof Error && error.message.includes("Missing required environment variable")) {
      return NextResponse.json({ error: "Server configuration error: Supabase env is missing." }, { status: 500 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
