import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { getAppUrl, issuePasswordResetLink } from "@/lib/admin/password-reset";
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

    const appUrl = getAppUrl(req);
    const resetLink = await issuePasswordResetLink(profile.id, appUrl);
    await sendPasswordResetEmail(email, profile.display_name ?? "there", resetLink.url, `${appUrl}/admin`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Forgot password request failed:", err);
    return NextResponse.json({ ok: true });
  }
}
