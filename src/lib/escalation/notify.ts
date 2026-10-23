import { sendEscalationEmail } from "@/lib/email/postmark";
import { getSupabaseAdmin } from "@/lib/supabase/server";

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

// Notify all escalation team members by email (if they have one). Email only: the WhatsApp
// number is gone, so the escalation_ticket_assigned template alert was removed. Fire-and-forget
// per recipient; failures are logged, never thrown.
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

  return members.length;
}
