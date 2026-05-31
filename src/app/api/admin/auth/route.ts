import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { verifyPassword } from "@/lib/admin/passwords";
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
    const { data: user, error } = await supabase
      .from("whatsapp_users")
      .select("id, display_name, email, global_role, role, password_hash")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    if (!isAdminOrLeadership(user)) {
      return NextResponse.json({ error: "Access denied. Admin role required." }, { status: 403 });
    }

    const passwordHash = typeof user.password_hash === "string" ? user.password_hash : null;
    const legacyPassword = optionalEnv("ADMIN_FALLBACK_PASSWORD") ?? "786110";
    const validPassword = passwordHash
      ? await verifyPassword(password, passwordHash)
      : password === legacyPassword;

    if (!validPassword) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Return a simple session token (user ID based for simplicity)
    const token = Buffer.from(`${user.id}:${user.email}:${Date.now()}`).toString("base64");

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        display_name: user.display_name,
        email: user.email,
        role: user.role,
        global_role: user.global_role,
      },
    });
  } catch (error) {
    console.error("Admin login failed", error);
    if (error instanceof Error && error.message.includes("Missing required environment variable")) {
      return NextResponse.json({ error: "Server configuration error: Supabase env is missing." }, { status: 500 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
