import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { hashPassword, isValidNewPassword, verifyPassword } from "@/lib/admin/passwords";
import { optionalEnv } from "@/lib/env";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProfileBody = {
  display_name?: unknown;
  email?: unknown;
  current_password?: unknown;
  new_password?: unknown;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PUT: a signed-in user updates their own display name and/or password.
// Changing the password requires the correct current password.
export async function PUT(req: NextRequest) {
  const auth = await requirePortalCaller(req, () => true);
  if (auth instanceof NextResponse) return auth;

  if (auth.caller.user_id === "admin-api") {
    return NextResponse.json({ error: "Profile routes require a user session" }, { status: 400 });
  }

  const id = auth.caller.user_id;

  const body = (await req.json().catch(() => ({}))) as ProfileBody;

  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : undefined;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
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

  // Email is the login identity, so only admins/leadership may change their own.
  if (email !== undefined && email !== (user.email ?? "").toLowerCase()) {
    if (!isAdminOrLeadership(auth.caller.portal)) {
      return NextResponse.json({ error: "Only an admin can change the email" }, { status: 403 });
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    const { data: taken } = await supabase
      .from("whatsapp_users")
      .select("id")
      .ilike("email", email)
      .neq("id", id)
      .maybeSingle();
    if (taken) {
      return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
    }
    updates.email = email;
  }

  if (newPassword) {
    if (!isValidNewPassword(newPassword)) {
      return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
    }
    const storedHash = typeof user.password_hash === "string" ? user.password_hash : null;
    const legacyPassword = optionalEnv("ADMIN_FALLBACK_PASSWORD");
    const currentValid = storedHash
      ? await verifyPassword(currentPassword, storedHash)
      : Boolean(legacyPassword && currentPassword === legacyPassword);
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
