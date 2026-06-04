import { issuePasswordResetLink, getAppUrl } from "@/lib/admin/password-reset";
import { sendWelcomeAdminEmail } from "@/lib/email/postmark";
import { sendWhatsAppText } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin, recordOutboundMessage, touchConversationSession } from "@/lib/supabase/server";

export type WelcomeNotificationResult = {
  email: "sent" | "skipped" | "failed";
  whatsapp: "sent" | "skipped" | "failed";
  set_password_url?: string;
  errors: string[];
};

type SendWelcomeInput = {
  userId: string;
  departmentId: string;
  appUrl?: string;
};

type WelcomeUser = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone_e164: string | null;
};

type WelcomeDepartment = {
  id: string;
  name: string | null;
};

export async function sendAdminWelcomeNotification(input: SendWelcomeInput): Promise<WelcomeNotificationResult> {
  const result: WelcomeNotificationResult = {
    email: "skipped",
    whatsapp: "skipped",
    errors: [],
  };
  const supabase = getSupabaseAdmin();

  const [{ data: user, error: userError }, { data: department, error: departmentError }] = await Promise.all([
    supabase
      .from("whatsapp_users")
      .select("id, display_name, email, phone_e164")
      .eq("id", input.userId)
      .maybeSingle(),
    supabase
      .from("departments")
      .select("id, name")
      .eq("id", input.departmentId)
      .maybeSingle(),
  ]);

  if (userError) result.errors.push(`Failed to load welcome user: ${userError.message}`);
  if (departmentError) result.errors.push(`Failed to load welcome department: ${departmentError.message}`);
  if (!user) result.errors.push("Welcome user was not found.");
  if (!department) result.errors.push("Welcome department was not found.");

  if (!user || !department) {
    return result;
  }

  const typedUser = user as WelcomeUser;
  const typedDepartment = department as WelcomeDepartment;
  const appUrl = input.appUrl ?? getAppUrl();
  const loginUrl = `${appUrl}/admin/login`;
  const memberName = typedUser.display_name || "there";
  const departmentName = typedDepartment.name || "your department";
  const resetLink = await issuePasswordResetLink(typedUser.id, appUrl);
  result.set_password_url = resetLink.url;

  if (typedUser.email) {
    try {
      await sendWelcomeAdminEmail(typedUser.email, memberName, departmentName, resetLink.url, loginUrl);
      result.email = "sent";
    } catch (err) {
      result.email = "failed";
      result.errors.push(err instanceof Error ? err.message : "Welcome email failed.");
      console.error(`Failed to send welcome email to ${typedUser.email}:`, err);
    }
  }

  if (typedUser.phone_e164) {
    const body = welcomeWhatsAppBody(memberName, departmentName, resetLink.url, loginUrl);
    try {
      const metaResponse = await sendWhatsAppText(typedUser.phone_e164, body);
      await recordOutboundMessage({
        phoneE164: typedUser.phone_e164,
        body,
        whatsappMessageId: metaResponse.messages?.[0]?.id,
        rawPayload: {
          source: "admin_welcome",
          department_id: typedDepartment.id,
          meta_response: metaResponse,
        },
      });
      await touchConversationSession({ phoneE164: typedUser.phone_e164, userId: typedUser.id });
      result.whatsapp = "sent";
    } catch (err) {
      result.whatsapp = "failed";
      result.errors.push(err instanceof Error ? err.message : "Welcome WhatsApp message failed.");
      console.error(`Failed to send welcome WhatsApp message to ${typedUser.phone_e164}:`, err);
    }
  }

  return result;
}

function welcomeWhatsAppBody(
  memberName: string,
  departmentName: string,
  setPasswordUrl: string,
  loginUrl: string,
) {
  return [
    `Hi ${memberName}, welcome to the Chicago Relay Center committee platform.`,
    "",
    `You've been added as a committee member for ${departmentName}.`,
    "",
    "Set your password and log in here:",
    setPasswordUrl,
    "",
    "You can also access the portal directly here:",
    loginUrl,
  ].join("\n");
}
