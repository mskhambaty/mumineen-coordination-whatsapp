import { requireEnv } from "@/lib/env";

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
  return sendTemplateEmail({
    To: to,
    TemplateAlias: requireEnv("POSTMARK_PASSWORD_RESET_TEMPLATE"),
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
) {
  const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");
  const templateAlias = process.env.POSTMARK_ASSIGNMENT_TEMPLATE ?? "assignment-notification";
  const actionUrl = itemType === "milestone" ? `${appUrl}/admin/milestones` : `${appUrl}/admin/tasks`;

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
