import { optionalEnv, requireEnv } from "@/lib/env";

const POSTMARK_API = "https://api.postmarkapp.com";

type PostmarkTemplatePayload = {
  To: string;
  TemplateAlias: string;
  TemplateModel: Record<string, unknown>;
};

type PostmarkTemplateResponse = {
  To: string;
  SubmittedAt: string;
  MessageID: string;
  ErrorCode: number;
  Message: string;
};

export type TaskNotificationEmailTask = {
  title: string;
  status: string;
  priority: string;
  department: string;
  due_date?: string;
};

async function sendTemplateEmail(payload: PostmarkTemplatePayload): Promise<PostmarkTemplateResponse> {
  const res = await fetch(`${POSTMARK_API}/email/withTemplate`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": requireEnv("POSTMARK_API_TOKEN"),
    },
    body: JSON.stringify({
      MessageStream: "outbound",
      From: requireEnv("POSTMARK_FROM_EMAIL"),
      ...payload,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Postmark error ${res.status}: ${errorBody}`);
  }

  return (await res.json()) as PostmarkTemplateResponse;
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string,
  supportUrl: string,
) {
  const templateAlias = optionalEnv("POSTMARK_PASSWORD_RESET_TEMPLATE") ?? "password-reset";

  return sendTemplateEmail({
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: {
      name,
      product_name: "Anjuman e Saifee Chicago Portal",
      action_url: resetUrl,
      operating_system: "Unknown",
      browser_name: "Unknown",
      support_url: supportUrl,
    },
  });
}

export async function sendWelcomeAdminEmail(
  to: string,
  memberName: string,
  departmentName: string,
  setPasswordUrl: string,
  loginUrl: string,
) {
  const templateAlias = optionalEnv("POSTMARK_WELCOME_ADMIN_TEMPLATE") ?? "welcome-admin-email";

  return sendTemplateEmail({
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: {
      member_name: memberName,
      department_name: departmentName,
      set_password_url: setPasswordUrl,
      login_url: loginUrl,
    },
  });
}

export async function sendTaskNotificationEmail(
  to: string,
  name: string,
  tasks: TaskNotificationEmailTask[],
  boardUrl: string,
) {
  return sendTemplateEmail({
    To: to,
    TemplateAlias: requireEnv("POSTMARK_TASK_NOTIFICATION_TEMPLATE"),
    TemplateModel: {
      name,
      tasks,
      action_url: boardUrl,
      notifications_url: `${requireEnv("NEXT_PUBLIC_APP_URL")}/admin/tasks`,
    },
  });
}

export async function sendRawEmail(to: string, subject: string, htmlBody: string, textBody: string): Promise<void> {
  const res = await fetch(`${POSTMARK_API}/email`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": requireEnv("POSTMARK_API_TOKEN"),
    },
    body: JSON.stringify({
      MessageStream: "outbound",
      From: requireEnv("POSTMARK_FROM_EMAIL"),
      To: to,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
    }),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Postmark error ${res.status}: ${errorBody}`);
  }
}

export async function sendRegistrationOtpEmail(
  to: string,
  recipientName: string,
  otp: string,
  expiryMinutes: number,
): Promise<void> {
  const subject = "Your registration edit code — Ashara Mubaraka 1448H Chicago";
  const htmlBody = `
<p>Salaamun Alaikum ${recipientName},</p>
<p>Your one-time code to edit your Ashara Mubaraka 1448H registration is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0a3d2e;">${otp}</p>
<p>This code expires in ${expiryMinutes} minutes.</p>
<p>If you did not request this, please ignore this email or contact our helpline on WhatsApp at <a href="https://wa.me/16308190250">+1 630 819 0250</a>.</p>
<p>Anjuman e Saifee Chicago</p>
`.trim();
  const textBody = [
    `Salaamun Alaikum ${recipientName},`,
    ``,
    `Your one-time code to edit your Ashara Mubaraka 1448H registration is:`,
    ``,
    otp,
    ``,
    `This code expires in ${expiryMinutes} minutes.`,
    ``,
    `If you did not request this, please contact our helpline on WhatsApp at +1 630 819 0250.`,
    ``,
    `Anjuman e Saifee Chicago`,
  ].join("\n");
  await sendRawEmail(to, subject, htmlBody, textBody);
}

export async function sendEscalationEmail(to: string, model: Record<string, unknown>) {
  const templateAlias = process.env.POSTMARK_ESCALATION_REQUEST_TEMPLATE ?? "escalation-request";
  return sendTemplateEmail({
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: model,
  });
}

export async function sendAssignmentNotificationEmail(
  to: string,
  recipientName: string,
  itemType: "milestone" | "task" | "issue",
  itemTitle: string,
  departmentName: string,
  actionUrlOverride?: string,
) {
  const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");
  const templateAlias = optionalEnv("POSTMARK_ASSIGNMENT_TEMPLATE") ?? "assignment-notification";
  const actionUrl = actionUrlOverride ?? (itemType === "milestone" ? `${appUrl}/admin/milestones` : `${appUrl}/admin/tasks`);

  return sendTemplateEmail({
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: {
      name: recipientName,
      product_name: "Anjuman e Saifee Chicago Portal",
      item_type: itemType,
      item_title: itemTitle,
      department_name: departmentName,
      action_url: actionUrl,
    },
  }).catch((err) => {
    console.error(`Failed to send ${itemType} assignment email to ${to}:`, err);
  });
}
