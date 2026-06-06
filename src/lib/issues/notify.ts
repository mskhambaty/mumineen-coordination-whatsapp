import { sendAssignmentNotificationEmail } from "@/lib/email/postmark";
import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveApprovedTemplate, sendTemplateNotification } from "@/lib/whatsapp/send-template";
import type { TemplateDescriptor } from "@/lib/whatsapp/templates";

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

  // Resolve the approved template once for the whole fan-out; if it's missing we
  // still send the emails below and just skip WhatsApp (best-effort second channel).
  let descriptor: TemplateDescriptor | null = null;
  try {
    descriptor = await resolveApprovedTemplate(ISSUE_TEMPLATE_NAME);
  } catch (err) {
    console.error("Issue WhatsApp template unavailable; sending email only:", err);
  }

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

      if (user.phone_e164 && descriptor) {
        await sendTemplateNotification({
          phoneE164: user.phone_e164,
          userId: user.id,
          templateName: ISSUE_TEMPLATE_NAME,
          bodyParams: [issue.title, description, url],
          source: "department_issue_contact",
          rawPayloadExtra: { issue_id: issue.issueId },
          descriptor,
        });
      }
    }),
  );

  return notifiedUsers.size;
}
