import { NextRequest, NextResponse } from "next/server";

import { verifyPassword } from "@/lib/admin/passwords";
import { buildPortalSessionUser, createPortalSessionToken } from "@/lib/admin/session";
import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Check if user exists and has admin/leadership_admin role
    let { data: user, error } = await supabase
      .from("whatsapp_users")
      .select("id, display_name, email, global_role, role, password_hash, is_master_admin")
      .eq("email", email)
      .maybeSingle();

    if (error?.message.includes("password_hash")) {
      const fallbackResult = await supabase
        .from("whatsapp_users")
        .select("id, display_name, email, global_role, role, is_master_admin")
        .eq("email", email)
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
      is_master_admin: user.is_master_admin,
    });

    if (
      sessionUser.role !== "admin" &&
      sessionUser.global_role !== "leadership_admin" &&
      !sessionUser.is_master_admin &&
      !sessionUser.is_support &&
      !sessionUser.is_manager &&
      !sessionUser.is_it &&
      !sessionUser.is_internal
    ) {
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

    // Return a simple session token (user ID based for simplicity)
    const token = createPortalSessionToken(user);

    return NextResponse.json({
      token,
      user: sessionUser,
    });
  } catch (error) {
    console.error("Admin login failed", error);
    if (error instanceof Error && error.message.includes("Missing required environment variable")) {
      return NextResponse.json({ error: "Server configuration error: Supabase env is missing." }, { status: 500 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
