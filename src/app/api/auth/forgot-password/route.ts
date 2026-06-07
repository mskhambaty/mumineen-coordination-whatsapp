import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { emailMatchPattern, normalizeEmail } from "@/lib/admin/email";
import { getAppUrl, issuePasswordResetLink } from "@/lib/admin/password-reset";
import { sendPasswordResetEmail } from "@/lib/email/postmark";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type ForgotPasswordRequest = {
  email?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ForgotPasswordRequest;
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";

    if (!email) {
      return NextResponse.json({ ok: true });
    }

    const supabase = getSupabaseAdmin();

    // Case-insensitive lookup: stored emails may be mixed-case, and an exact
    // match would silently miss those users.
    const { data: profile } = await supabase
      .from("whatsapp_users")
      .select("id, display_name, email, role, global_role, status")
      .ilike("email", emailMatchPattern(email))
      .maybeSingle();

    // Anyone who can sign in to the portal can reset their password — any
    // non-visitor user, including those not yet assigned to a department. We
    // still return the generic 200 below so a caller can't probe which
    // addresses exist.
    if (!profile?.email || profile.status !== "active" || !canAccessPortal(profile)) {
      return NextResponse.json({ ok: true });
    }

    const appUrl = getAppUrl(req);
    const resetLink = await issuePasswordResetLink(profile.id, appUrl);
    // Send to the address on file (preserves its display form) rather than the
    // normalized lookup value.
    await sendPasswordResetEmail(profile.email, profile.display_name ?? "there", resetLink.url, `${appUrl}/admin`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Forgot password request failed:", err);
    return NextResponse.json({ ok: true });
  }
}
