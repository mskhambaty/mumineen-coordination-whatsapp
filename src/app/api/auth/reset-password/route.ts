import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { hashPassword, hashPasswordResetToken, isValidNewPassword } from "@/lib/admin/passwords";
import { buildPortalSessionUser, createPortalSessionToken } from "@/lib/admin/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type ResetPasswordRequest = {
  token?: unknown;
  password?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ResetPasswordRequest;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!token || !isValidNewPassword(password)) {
      return NextResponse.json({ error: "Enter a valid reset link and a password with at least 8 characters." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const tokenHash = hashPasswordResetToken(token);

    const { data: user, error: lookupError } = await supabase
      .from("whatsapp_users")
      .select("id, display_name, email, role, global_role, status, password_reset_expires_at")
      .eq("password_reset_token_hash", tokenHash)
      .maybeSingle();

    if (lookupError) {
      console.error("Failed to look up password reset token:", lookupError.message);
      return NextResponse.json({ error: "Unable to reset password right now." }, { status: 500 });
    }

    const expiresAt = user?.password_reset_expires_at
      ? new Date(user.password_reset_expires_at as string).getTime()
      : 0;

    if (!user || user.status !== "active" || !isAdminOrLeadership(user) || expiresAt <= Date.now()) {
      return NextResponse.json({ error: "This reset link is invalid or expired." }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const { error: updateError } = await supabase
      .from("whatsapp_users")
      .update({
        password_hash: passwordHash,
        password_updated_at: new Date().toISOString(),
        password_reset_token_hash: null,
        password_reset_expires_at: null,
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Failed to update password:", updateError.message);
      return NextResponse.json({ error: "Unable to reset password right now." }, { status: 500 });
    }

    const sessionUser = await buildPortalSessionUser({
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      global_role: user.global_role,
    });

    return NextResponse.json({
      ok: true,
      token: createPortalSessionToken(sessionUser),
      user: sessionUser,
    });
  } catch (err) {
    console.error("Password reset failed:", err);
    return NextResponse.json({ error: "Unable to reset password right now." }, { status: 500 });
  }
}
