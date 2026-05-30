import { NextRequest, NextResponse } from "next/server";

import { optionalEnv } from "@/lib/env";
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
      .select("display_name, email")
      .eq("email", email)
      .maybeSingle();

    if (!profile?.email) {
      return NextResponse.json({ ok: true });
    }

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: optionalEnv("NEXT_PUBLIC_APP_URL")
        ? { redirectTo: `${optionalEnv("NEXT_PUBLIC_APP_URL")}/admin/login` }
        : undefined,
    });

    const resetUrl = data.properties?.action_link;
    if (!error && resetUrl) {
      await sendPasswordResetEmail(email, profile.display_name ?? "there", resetUrl);
    } else if (error) {
      console.error("Failed to generate password reset link:", error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Forgot password request failed:", err);
    return NextResponse.json({ ok: true });
  }
}
