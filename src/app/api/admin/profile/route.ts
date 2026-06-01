import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { hashPassword, isValidNewPassword, verifyPassword } from "@/lib/admin/passwords";
import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProfileBody = {
  id?: unknown;
  display_name?: unknown;
  current_password?: unknown;
  new_password?: unknown;
};

// PUT: a signed-in user updates their own display name and/or password.
// Changing the password requires the correct current password.
export async function PUT(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as ProfileBody;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : undefined;
  const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";

  const supabase = getSupabaseAdmin();
  const { data: user, error: lookupError } = await supabase
    .from("whatsapp_users")
    .select("id, display_name, email, password_hash")
    .eq("id", id)
    .maybeSingle();

  if (lookupError || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  if (displayName !== undefined) {
    if (!displayName) {
      return NextResponse.json({ error: "Display name can't be empty" }, { status: 400 });
    }
    updates.display_name = displayName;
  }

  if (newPassword) {
    if (!isValidNewPassword(newPassword)) {
      return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
    }
    const storedHash = typeof user.password_hash === "string" ? user.password_hash : null;
    const legacyPassword = optionalEnv("ADMIN_FALLBACK_PASSWORD") ?? "786110";
    const currentValid = storedHash
      ? await verifyPassword(currentPassword, storedHash)
      : currentPassword === legacyPassword;
    if (!currentValid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }
    updates.password_hash = await hashPassword(newPassword);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("whatsapp_users")
    .update(updates)
    .eq("id", id)
    .select("id, display_name, email")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ id: updated.id, display_name: updated.display_name, email: updated.email });
}
