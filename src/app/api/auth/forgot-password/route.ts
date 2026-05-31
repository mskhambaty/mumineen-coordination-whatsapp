import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { createPasswordResetToken } from "@/lib/admin/passwords";
import { requireEnv } from "@/lib/env";
import { sendPasswordResetEmail } from "@/lib/email/postmark";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type ForgotPasswordRequest = {
  email?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ForgotPasswordRequest;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json({ ok: true });
    }

    const supabase = getSupabaseAdmin();

    const { data: profile } = await supabase
      .from("whatsapp_users")
      .select("id, display_name, email, role, global_role, status")
      .eq("email", email)
      .maybeSingle();

    if (!profile?.email || profile.status !== "active" || !isAdminOrLeadership(profile)) {
      return NextResponse.json({ ok: true });
    }

    const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");
    const { token, tokenHash } = createPasswordResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("whatsapp_users")
      .update({
        password_reset_token_hash: tokenHash,
        password_reset_expires_at: expiresAt,
      })
      .eq("id", profile.id);

    if (updateError) {
      console.error("Failed to store password reset token:", updateError.message);
      return NextResponse.json({ ok: true });
    }

    const resetUrl = `${appUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
    await sendPasswordResetEmail(email, profile.display_name ?? "there", resetUrl);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Forgot password request failed:", err);
    return NextResponse.json({ ok: true });
  }
}
