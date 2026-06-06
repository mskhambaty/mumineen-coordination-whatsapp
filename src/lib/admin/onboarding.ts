import { issuePasswordResetLink, getAppUrl } from "@/lib/admin/password-reset";
import { sendWelcomeAdminEmail } from "@/lib/email/postmark";
import { listMessageTemplates, sendWhatsAppTemplateComponents } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin, recordOutboundMessage, touchConversationSession } from "@/lib/supabase/server";
import { buildSendComponents, describeTemplate, previewBody } from "@/lib/whatsapp/templates";

// Approved WhatsApp template used to welcome a new committee member. A template
// (unlike a free-text send) delivers whether or not the recipient has an open
// 24h customer-service window, and Meta does not charge for utility templates
// sent inside an open window — so it is sent unconditionally. Its body carries
// four variables: {{1}} member name, {{2}} committee(s), {{3}} password-setup
// link, {{4}} admin portal login URL.
const WELCOME_TEMPLATE_NAME = "committee_platform_access_created";

// The admin portal login is always the production portal, so it is fixed here
// rather than derived from the (environment-dependent) app URL.
const ADMIN_LOGIN_URL = "https://www.chicagorelaycenter.com/admin/login";

export type WelcomeNotificationResult = {
  email: "sent" | "skipped" | "failed";
  whatsapp: "sent" | "skipped" | "failed";
  already_welcomed: boolean;
  set_password_url?: string;
  errors: string[];
};

type SendWelcomeInput = {
  userId: string;
  departmentId: string;
  appUrl?: string;
  // The manual "Send welcome" admin action sets this so an admin can re-send on
  // request (e.g. the member lost their original link). The automatic
  // add-to-department flow leaves it false so each user is welcomed only once.
  force?: boolean;
};

type WelcomeUser = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone_e164: string | null;
  welcomed_at: string | null;
};

type WelcomeDepartment = {
  id: string;
  name: string | null;
};

// Whether to send the welcome at all: always when forced (manual re-send),
// otherwise only if the user has never been welcomed before.
export function shouldSendWelcome(welcomedAt: string | null | undefined, force: boolean): boolean {
  return force || !welcomedAt;
}

// Join committee names for the template's {{2}} variable: "A", "A and B",
// "A, B, and C". Falls back to the triggering department when none are active.
export function formatCommittees(names: string[], fallback: string): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return fallback;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

export async function sendAdminWelcomeNotification(input: SendWelcomeInput): Promise<WelcomeNotificationResult> {
  const result: WelcomeNotificationResult = {
    email: "skipped",
    whatsapp: "skipped",
    already_welcomed: false,
    errors: [],
  };
  const supabase = getSupabaseAdmin();

  const [{ data: user, error: userError }, { data: department, error: departmentError }] = await Promise.all([
    supabase
      .from("whatsapp_users")
      .select("id, display_name, email, phone_e164, welcomed_at")
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

  // Once per user: the automatic add-to-department path skips anyone already
  // welcomed. The manual admin action forces a re-send.
  if (!shouldSendWelcome(typedUser.welcomed_at, input.force === true)) {
    result.already_welcomed = true;
    return result;
  }

  const appUrl = input.appUrl ?? getAppUrl();
  const memberName = typedUser.display_name || "there";
  const fallbackDepartment = typedDepartment.name || "your committee";
  const resetLink = await issuePasswordResetLink(typedUser.id, appUrl);
  result.set_password_url = resetLink.url;

  // The committee variable lists every committee the user is currently active
  // in (so a member added to several before the welcome fires sees them all),
  // falling back to the triggering department.
  const committees = await loadActiveCommitteeNames(typedUser.id, fallbackDepartment);

  if (typedUser.email) {
    try {
      await sendWelcomeAdminEmail(typedUser.email, memberName, committees, resetLink.url, ADMIN_LOGIN_URL);
      result.email = "sent";
    } catch (err) {
      result.email = "failed";
      result.errors.push(err instanceof Error ? err.message : "Welcome email failed.");
      console.error(`Failed to send welcome email to user ${typedUser.id}:`, err);
    }
  }

  if (typedUser.phone_e164) {
    try {
      const templates = await listMessageTemplates();
      const raw = templates.find(
        (t) => t.name === WELCOME_TEMPLATE_NAME && t.status?.toUpperCase() === "APPROVED",
      );
      if (!raw) {
        throw new Error(`Approved WhatsApp template "${WELCOME_TEMPLATE_NAME}" was not found.`);
      }
      const desc = describeTemplate(raw);
      const bodyParams = [memberName, committees, resetLink.url, ADMIN_LOGIN_URL];
      if (bodyParams.length < desc.bodyVarCount) {
        throw new Error(`Template "${raw.name}" expects ${desc.bodyVarCount} variables.`);
      }
      const components = buildSendComponents({ bodyParams }, desc);
      const metaResponse = await sendWhatsAppTemplateComponents(typedUser.phone_e164, raw.name, raw.language, components);
      await recordOutboundMessage({
        phoneE164: typedUser.phone_e164,
        body: `[template:${raw.name}] ${previewBody(desc.bodyText, bodyParams)}`.trim(),
        whatsappMessageId: metaResponse.messages?.[0]?.id,
        rawPayload: {
          source: "admin_welcome",
          template: raw.name,
          department_id: typedDepartment.id,
          meta_response: metaResponse,
        },
      });
      await touchConversationSession({ phoneE164: typedUser.phone_e164, userId: typedUser.id });
      result.whatsapp = "sent";
    } catch (err) {
      result.whatsapp = "failed";
      result.errors.push(err instanceof Error ? err.message : "Welcome WhatsApp message failed.");
      console.error(`Failed to send welcome WhatsApp template to user ${typedUser.id}:`, err);
    }
  }

  // Stamp the welcome only once at least one channel actually delivered, so a
  // transient failure doesn't permanently suppress the user's welcome.
  if (result.email === "sent" || result.whatsapp === "sent") {
    const { error: stampError } = await supabase
      .from("whatsapp_users")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("id", typedUser.id);
    if (stampError) {
      result.errors.push(`Failed to record welcome timestamp: ${stampError.message}`);
      console.error(`Failed to stamp welcomed_at for user ${typedUser.id}:`, stampError);
    }
  }

  return result;
}

// Names of the committees the user is currently an active member of, used for
// the welcome's committee variable. Falls back to the triggering department on
// error or when the user has no active memberships yet.
async function loadActiveCommitteeNames(userId: string, fallback: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("department_members")
    .select("department:departments(name)")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error || !data) {
    if (error) console.error(`Failed to load committees for user ${userId}:`, error);
    return fallback;
  }

  const names = (data as Array<{ department: { name: string | null } | { name: string | null }[] | null }>)
    .map((row) => (Array.isArray(row.department) ? row.department[0] : row.department))
    .map((dept) => dept?.name ?? "")
    .filter(Boolean);

  return formatCommittees(names, fallback);
}
