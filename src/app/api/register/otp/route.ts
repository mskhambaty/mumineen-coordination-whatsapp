import { createHash, randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendRegistrationOtpEmail } from "@/lib/email/postmark";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({ its: z.string().min(1).max(20) });

const OTP_EXPIRY_MINUTES = 10;
const RATE_LIMIT_SECONDS = 120;

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const { its } = parsed;
  const supabase = getSupabaseAdmin();

  // Resolve ITS to hof_its
  const { data: member } = await supabase
    .from("mumineen")
    .select("hof_its")
    .eq("its", its)
    .eq("roster_active", true)
    .maybeSingle();

  const hofIts = member?.hof_its ?? null;
  if (!hofIts) {
    return NextResponse.json({ error: "ITS number not found." }, { status: 404 });
  }

  // Must be a submitted/confirmed registration to allow editing
  const { data: family } = await supabase
    .from("families")
    .select("registration_status")
    .eq("hof_its", hofIts)
    .eq("roster_active", true)
    .maybeSingle();

  if (!family || (family.registration_status !== "submitted" && family.registration_status !== "confirmed")) {
    return NextResponse.json({ error: "Registration is not yet submitted." }, { status: 400 });
  }

  // Rate limit: one OTP per 2 minutes per family
  const cooldownCutoff = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000).toISOString();
  const { data: recent } = await supabase
    .from("registration_otps")
    .select("id")
    .eq("hof_its", hofIts)
    .gt("created_at", cooldownCutoff)
    .limit(1)
    .maybeSingle();

  if (recent) {
    return NextResponse.json(
      { error: "Please wait 2 minutes before requesting another code." },
      { status: 429 },
    );
  }

  // Determine OTP recipient: HoF if present in mumineen, else eldest family member
  let recipientIts: string;
  let recipientEmail: string;
  let recipientName: string;

  const { data: hof } = await supabase
    .from("mumineen")
    .select("its, full_name, email")
    .eq("its", hofIts)
    .eq("roster_active", true)
    .maybeSingle();

  if (hof?.email) {
    recipientIts = hof.its;
    recipientEmail = hof.email;
    recipientName = hof.full_name ?? hof.its;
  } else {
    // HoF not attending — fall back to eldest family member with an email
    const { data: eldest } = await supabase
      .from("mumineen")
      .select("its, full_name, email")
      .eq("hof_its", hofIts)
      .eq("roster_active", true)
      .not("email", "is", null)
      .order("age", { ascending: false, nullsFirst: false })
      .order("its", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!eldest?.email) {
      return NextResponse.json(
        { error: "No email address found for this family. Please contact the helpline on WhatsApp at +1 630 819 0250." },
        { status: 422 },
      );
    }
    recipientIts = eldest.its;
    recipientEmail = eldest.email;
    recipientName = eldest.full_name ?? eldest.its;
  }

  // Generate cryptographically secure 6-digit OTP
  const otp = String(randomInt(100000, 1000000));
  const otpHash = createHash("sha256").update(otp).digest("hex");
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const { error: insertError } = await supabase.from("registration_otps").insert({
    hof_its: hofIts,
    otp_hash: otpHash,
    recipient_its: recipientIts,
    email_sent_to: recipientEmail,
    expires_at: expiresAt,
  });

  if (insertError) {
    return NextResponse.json({ error: "Failed to generate code. Please try again." }, { status: 500 });
  }

  try {
    await sendRegistrationOtpEmail(recipientEmail, recipientName, otp, OTP_EXPIRY_MINUTES);
  } catch {
    return NextResponse.json({ error: "Failed to send email. Please try again." }, { status: 500 });
  }

  // Return masked email hint (first 2 chars + *** + @domain)
  const atIdx = recipientEmail.indexOf("@");
  const localPart = atIdx > 0 ? recipientEmail.slice(0, atIdx) : recipientEmail;
  const domain = atIdx > 0 ? recipientEmail.slice(atIdx) : "";
  const maskedEmail = `${localPart.slice(0, 2)}***${domain}`;

  return NextResponse.json({ masked_email: maskedEmail });
}
