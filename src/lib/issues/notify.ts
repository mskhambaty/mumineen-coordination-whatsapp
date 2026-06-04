import { sendAssignmentNotificationEmail } from "@/lib/email/postmark";
import { optionalEnv } from "@/lib/env";
import { sendWhatsAppTemplate } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin, recordOutboundMessage, touchConversationSession } from "@/lib/supabase/server";

const ISSUE_TEMPLATE_NAME = "department_ticket_assigned";

type IssueContactRow = {
  user_id: string;
  department: { name: string | null } | { name: string | null }[] | null;
  user: {
    id: string;
    display_name: string | null;
    email: string | null;
    phone_e164: string | null;
  } | {
    id: string;
    display_name: string | null;
    email: string | null;
    phone_e164: string | null;
  }[] | null;
};

export type DepartmentIssueNotice = {
  issueId: string;
  title: string;
  description?: string | null;
  departmentId: string | null;
};

function appBaseUrl(): string {
  if (optionalEnv("NEXT_PUBLIC_APP_URL")) return optionalEnv("NEXT_PUBLIC_APP_URL") as string;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function issueUrl(issue: DepartmentIssueNotice): string {
  const base = appBaseUrl();
  const params = new URLSearchParams({ item_type: "issue", issue_id: issue.issueId });
  if (issue.departmentId) params.set("department_id", issue.departmentId);
  return `${base}/admin/tasks?${params.toString()}`;
}

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function templateBody(issue: DepartmentIssueNotice, url: string) {
  return [
    "A new Ashara 1448H support ticket has been assigned to your department.",
    "",
    `Issue: ${issue.title}`,
    `Description: ${issue.description?.trim() || "No description provided."}`,
    `View ticket in portal: ${url}`,
    "",
    "You can reply here to ask questions about this ticket, request more details, or close the ticket once it is resolved.",
  ].join("\n");
}

export async function notifyDepartmentIssueContacts(issue: DepartmentIssueNotice): Promise<number> {
  if (!issue.departmentId) return 0;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("department_members")
    .select("user_id, department:departments(name), user:whatsapp_users(id, display_name, email, phone_e164)")
    .eq("department_id", issue.departmentId)
    .eq("is_active", true)
    .eq("contact_for_issues", true);

  if (error || !data) {
    if (error) console.error("Failed to load department issue contacts", error);
    return 0;
  }

  const url = issueUrl(issue);
  const description = issue.description?.trim() || "No description provided.";
  const notifiedUsers = new Set<string>();

  await Promise.all(
    (data as unknown as IssueContactRow[]).map(async (row) => {
      const user = firstRelation(row.user);
      const department = firstRelation(row.department);
      if (!user?.id || notifiedUsers.has(user.id)) return;
      notifiedUsers.add(user.id);

      const name = user.display_name || "there";
      const departmentName = department?.name || "Department";

      if (user.email) {
        await sendAssignmentNotificationEmail(
          user.email,
          name,
          "issue",
          issue.title,
          departmentName,
          url,
        );
      }

      if (user.phone_e164) {
        await sendWhatsAppTemplate(user.phone_e164, ISSUE_TEMPLATE_NAME, [issue.title, description, url])
          .then(async (metaResponse) => {
            await recordOutboundMessage({
              phoneE164: user.phone_e164 as string,
              body: templateBody(issue, url),
              whatsappMessageId: metaResponse.messages?.[0]?.id,
              rawPayload: {
                source: "department_issue_contact",
                template: ISSUE_TEMPLATE_NAME,
                issue_id: issue.issueId,
                meta_response: metaResponse,
              },
            });
            await touchConversationSession({ phoneE164: user.phone_e164 as string, userId: user.id });
          })
          .catch((err) => console.error(`Issue WhatsApp template to ${user.phone_e164} failed:`, err));
      }
    }),
  );

  return notifiedUsers.size;
}
