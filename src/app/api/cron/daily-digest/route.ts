import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { sendTaskNotificationEmail, type TaskNotificationEmailTask } from "@/lib/email/postmark";
import { listPendingTranslations } from "@/lib/knowledge/religious-topics";
import { getSupabaseAdmin, recordToolAudit } from "@/lib/supabase/server";
import { priorityWeight } from "@/lib/tasks/types";

type DigestUser = {
  id: string;
  phone_e164: string;
  display_name: string | null;
  email: string;
  role: "visitor" | "committee" | "admin";
  global_role: "member" | "pm" | "hod" | "leadership_admin";
  email_digest: boolean;
};

type MembershipRow = {
  department_id: string;
  dept_role: string;
};

type DigestTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  department_id: string;
  updated_at: string;
  departments?: { name?: string | null } | { name?: string | null }[] | null;
};

type DigestResult = {
  sent: number;
  skipped: number;
  errors: { user_id: string; message: string }[];
};

export async function GET(req: Request) {
  return runDailyDigest(req);
}

export async function POST(req: Request) {
  return runDailyDigest(req);
}

async function runDailyDigest(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = "Bearer " + requireEnv("CRON_SECRET");
  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const result: DigestResult = { sent: 0, skipped: 0, errors: [] };

  try {
    const { data: users, error } = await supabase
      .from("whatsapp_users")
      .select("id, phone_e164, display_name, email, role, global_role, email_digest")
      .eq("status", "active")
      .eq("email_digest", true)
      .not("email", "is", null);

    if (error) {
      throw error;
    }

    for (const user of (users ?? []) as DigestUser[]) {
      const tasks = await getDigestTasksForUser(user);

      if (tasks.length === 0) {
        result.skipped++;
        continue;
      }

      try {
        await sendTaskNotificationEmail(
          user.email,
          user.display_name ?? "there",
          tasks.map(toEmailTask),
          `${requireEnv("NEXT_PUBLIC_APP_URL")}/admin/tasks`,
        );
        result.sent++;
      } catch (err) {
        result.errors.push({
          user_id: user.id,
          message: err instanceof Error ? err.message : "Unknown email error",
        });
      }
    }

    // Ashara translation reminders: email admins the Lisan ud Dawat items still awaiting
    // an English translation. Naturally a no-op outside Ashara (no pending items).
    const translationDigest = await sendTranslationDigest((users ?? []) as DigestUser[]);

    await recordToolAudit({
      phoneE164: "cron",
      toolName: "daily_digest",
      arguments: { users_considered: users?.length ?? 0 },
      allowed: true,
      resultSummary: JSON.stringify({ ...result, translationDigest }),
    });

    return NextResponse.json({ ok: true, ...result, translationDigest });
  } catch (err) {
    await recordToolAudit({
      phoneE164: "cron",
      toolName: "daily_digest",
      arguments: {},
      allowed: false,
      resultSummary: err instanceof Error ? err.message : "Unknown daily digest error",
    });

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Daily digest failed" },
      { status: 500 },
    );
  }
}

// Email admins/leadership the list of Ashara Lisan items pending English translation,
// reusing the task-notification template (each item rendered as a "task" row).
async function sendTranslationDigest(users: DigestUser[]): Promise<{ items: number; sent: number }> {
  const pending = await listPendingTranslations(process.env.ASHARA_YEAR || undefined);
  if (pending.length === 0) return { items: 0, sent: 0 };

  const admins = users.filter((u) => u.role === "admin" || u.global_role === "leadership_admin");
  const items: TaskNotificationEmailTask[] = pending.map((p) => ({
    title: p.title,
    status: "Needs translation",
    priority: "high",
    department: "Ashara content",
    due_date: undefined,
  }));
  const boardUrl = `${requireEnv("NEXT_PUBLIC_APP_URL")}/admin/ashara`;

  let sent = 0;
  for (const u of admins) {
    try {
      await sendTaskNotificationEmail(u.email, u.display_name ?? "there", items, boardUrl);
      sent++;
    } catch {
      // best-effort; failures are surfaced via the audit summary only
    }
  }
  return { items: pending.length, sent };
}

async function getDigestTasksForUser(user: DigestUser): Promise<DigestTaskRow[]> {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, due_date, department_id, updated_at, departments(name)")
    .eq("archived", false)
    .neq("status", "complete");

  if (user.role === "admin" || user.global_role === "leadership_admin") {
    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return sortDigestTasks(data ?? []);
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("department_members")
    .select("department_id, dept_role")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) {
    throw membershipError;
  }

  const elevatedMemberships = ((memberships ?? []) as MembershipRow[])
    .filter((row) => row.dept_role === "pm" || row.dept_role === "hod");

  if (elevatedMemberships.length > 0) {
    const departmentIds = Array.from(new Set(elevatedMemberships.map((row) => row.department_id)));
    if (departmentIds.length === 0) {
      return [];
    }
    query = query.in("department_id", departmentIds);
  } else {
    query = query.eq("assigned_to", user.id);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return sortDigestTasks(data ?? []);
}

function sortDigestTasks(tasks: DigestTaskRow[]) {
  return (tasks as DigestTaskRow[])
    .sort((a, b) => {
      const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
    })
    .slice(0, 50);
}

function toEmailTask(task: DigestTaskRow): TaskNotificationEmailTask {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    department: getDepartmentName(task.departments),
    due_date: task.due_date ?? undefined,
  };
}

function getDepartmentName(department: DigestTaskRow["departments"]) {
  if (Array.isArray(department)) {
    return department[0]?.name ?? "Unknown";
  }

  return department?.name ?? "Unknown";
}
