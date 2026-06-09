import { sendEscalationEmail } from "@/lib/email/postmark";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveApprovedTemplate, sendTemplateNotification } from "@/lib/whatsapp/send-template";
import type { TemplateDescriptor } from "@/lib/whatsapp/templates";

// Approved Meta utility template used to alert escalation team members about an
// escalation. Body variables: {{1}} request summary, {{2}} details, {{3}} portal link.
const ESCALATION_TEMPLATE_NAME = "escalation_ticket_assigned";

export type EscalationMember = { userId: string | null; name: string; email: string | null; phone: string | null };

type MemberRow = {
  user: { id: string | null; display_name: string | null; email: string | null; phone_e164: string | null } | null;
};

// All escalation team members. Deduped by user id.
export async function getEscalationMembers(): Promise<EscalationMember[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("escalation_support_members")
    .select("user:whatsapp_users(id, display_name, email, phone_e164)");

  if (error || !data) return [];

  const seen = new Set<string>();
  const members: EscalationMember[] = [];
  for (const row of data as unknown as MemberRow[]) {
    const id = row.user?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    members.push({
      userId: id,
      name: row.user?.display_name || "Support",
      email: row.user?.email?.trim() || null,
      phone: row.user?.phone_e164?.trim() || null,
    });
  }
  return members;
}

export type EscalationNotice = {
  guestName: string;
  guestPhone: string;
  reason: string;
  priority: "normal" | "urgent";
  category: string;
  conversationUrl: string;
};

function escalationRequestLabel(notice: EscalationNotice): string {
  const category = notice.category?.trim() || "other";
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return notice.priority === "urgent" ? `URGENT — ${label}` : label;
}

// Notify all escalation team members via email (if they have one) and WhatsApp
// (if they have a phone). Fire-and-forget per recipient/channel; failures are
// logged, never thrown.
export async function notifyEscalationTeam(notice: EscalationNotice): Promise<number> {
  const members = await getEscalationMembers();

  // Email
  await Promise.all(
    members
      .filter((m) => m.email)
      .map((member) =>
        sendEscalationEmail(member.email as string, {
          name: member.name,
          guest_name: notice.guestName,
          guest_phone: notice.guestPhone,
          reason: notice.reason,
          priority: notice.priority,
          priority_label: notice.priority === "urgent" ? "URGENT" : "Normal",
          category: notice.category,
          conversation_url: notice.conversationUrl,
          product_name: "Anjuman e Saifee Chicago Portal",
        }).catch((err) => console.error(`Escalation email failed (user ${member.userId ?? "unknown"}):`, err)),
      ),
  );

  // WhatsApp
  const phoneRecipients = members.filter((m) => m.phone);
  if (phoneRecipients.length > 0) {
    let descriptor: TemplateDescriptor | null = null;
    try {
      descriptor = await resolveApprovedTemplate(ESCALATION_TEMPLATE_NAME);
    } catch (err) {
      console.error("Escalation WhatsApp template unavailable; sent email only:", err);
    }
    if (descriptor) {
      await Promise.all(
        phoneRecipients.map((member) =>
          sendTemplateNotification({
            phoneE164: member.phone as string,
            userId: member.userId,
            templateName: ESCALATION_TEMPLATE_NAME,
            bodyParams: [escalationRequestLabel(notice), notice.reason, notice.conversationUrl],
            source: "escalation_oncall",
            rawPayloadExtra: { category: notice.category, priority: notice.priority },
            descriptor,
          }),
        ),
      );
    }
  }

  return members.length;
}
