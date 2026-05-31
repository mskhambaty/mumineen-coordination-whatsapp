"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";

type Department = { id: string; name: string };

type AnalyticsData = {
  departments: Department[];
  tasks: {
    total: number;
    active: number;
    overdue: number;
    blocked: number;
    by_status: Record<string, number>;
    by_priority: Record<string, number>;
    by_department: Array<{
      department_id: string;
      department_name: string;
      total: number;
      overdue: number;
      blocked: number;
    }>;
    overdue_list: Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      due_date: string | null;
      department_name: string;
    }>;
    issues: {
      total: number;
      open: number;
      blocked: number;
      resolved: number;
      by_status: Record<string, number>;
    };
  };
  conversations: {
    window_days: number;
    active_conversations: number;
    manual_conversations: number;
    ai_conversations: number;
    inbound_messages: number;
    outbound_messages: number;
    total_messages: number;
    tool_calls: number;
    blocked_tool_calls: number;
    messages_by_day: Array<{ date: string; inbound: number; outbound: number }>;
    top_tools: Array<{ name: string; count: number }>;
  };
};

export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [departmentId, setDepartmentId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  async function loadAnalytics() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (departmentId !== "all") params.set("department_id", departmentId);

    try {
      const res = await fetch(`/api/admin/analytics?${params.toString()}`, {
        headers: { "x-admin-key": adminKey },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load analytics");
      setData(json as AnalyticsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    const userRaw = localStorage.getItem("admin_user");
    const user = userRaw ? JSON.parse(userRaw) as { role?: string; global_role?: string } : null;
    if (!isAdminOrLeadership(user)) {
      router.push("/admin/tasks");
      return;
    }

    void Promise.resolve().then(loadAnalytics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, departmentId]);

  const maxDepartmentTotal = useMemo(
    () => Math.max(1, ...(data?.tasks.by_department.map((department) => department.total) ?? [1])),
    [data],
  );
  const maxDailyMessages = useMemo(
    () => Math.max(1, ...(data?.conversations.messages_by_day.map((day) => day.inbound + day.outbound) ?? [1])),
    [data],
  );

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}

        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Task and WhatsApp Health</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Task counts follow the selected department. WhatsApp metrics show the last 30 days.</p>
          </div>
          <select
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">All departments</option>
            {data?.departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        </div>

        {loading || !data ? (
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 p-10 text-center text-gray-500 dark:text-gray-400 shadow-sm">Loading analytics...</div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Metric label="Active Tasks" value={data.tasks.active} tone="blue" />
              <Metric label="Blocked Tasks" value={data.tasks.blocked} tone="red" />
              <Metric label="Overdue Tasks" value={data.tasks.overdue} tone="amber" />
              <Metric label="WhatsApp Threads" value={data.conversations.active_conversations} tone="green" />
            </section>

            {data.tasks.issues && (
              <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Metric label="Total Issues" value={data.tasks.issues.total} tone="amber" />
                <Metric label="Open Issues" value={data.tasks.issues.open} tone="red" />
                <Metric label="Blocked Issues" value={data.tasks.issues.blocked} tone="red" />
                <Metric label="Resolved Issues" value={data.tasks.issues.resolved} tone="green" />
              </section>
            )}

            <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Panel title="Tasks by Status">
                <BarRows
                  rows={[
                    { label: "Open", value: data.tasks.by_status.open ?? 0, color: "bg-blue-500" },
                    { label: "In Progress", value: data.tasks.by_status.in_progress ?? 0, color: "bg-indigo-500" },
                    { label: "Blocked", value: data.tasks.by_status.blocked ?? 0, color: "bg-red-500" },
                    { label: "Complete", value: data.tasks.by_status.complete ?? 0, color: "bg-green-500" },
                  ]}
                />
              </Panel>

              <Panel title="Tasks by Priority">
                <BarRows
                  rows={[
                    { label: "High", value: data.tasks.by_priority.high ?? 0, color: "bg-red-500" },
                    { label: "Medium", value: data.tasks.by_priority.medium ?? 0, color: "bg-amber-500" },
                    { label: "Low", value: data.tasks.by_priority.low ?? 0, color: "bg-gray-500" },
                  ]}
                />
              </Panel>

              {data.tasks.issues && data.tasks.issues.total > 0 && (
                <Panel title="Issues by Status">
                  <BarRows
                    rows={[
                      { label: "Open", value: data.tasks.issues.by_status.open ?? 0, color: "bg-orange-500" },
                      { label: "In Progress", value: data.tasks.issues.by_status.in_progress ?? 0, color: "bg-blue-500" },
                      { label: "Blocked", value: data.tasks.issues.by_status.blocked ?? 0, color: "bg-red-500" },
                      { label: "Resolved", value: data.tasks.issues.by_status.complete ?? 0, color: "bg-green-500" },
                    ]}
                  />
                </Panel>
              )}
            </section>

            <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <Panel title="Department Load">
                <div className="space-y-3">
                  {data.tasks.by_department.slice(0, 12).map((department) => (
                    <div key={department.department_id}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium">{department.department_name}</span>
                        <span className="text-gray-500 dark:text-gray-400">{department.total}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700">
                        <div
                          className="h-2 rounded-full bg-blue-600"
                          style={{ width: `${Math.max(4, (department.total / maxDepartmentTotal) * 100)}%` }}
                        />
                      </div>
                      {(department.blocked > 0 || department.overdue > 0) && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{department.blocked} blocked · {department.overdue} overdue</p>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="WhatsApp Conversation Modes">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="AI Mode" value={data.conversations.ai_conversations} tone="blue" compact />
                  <Metric label="Manual Mode" value={data.conversations.manual_conversations} tone="amber" compact />
                  <Metric label="Inbound" value={data.conversations.inbound_messages} tone="green" compact />
                  <Metric label="Outbound" value={data.conversations.outbound_messages} tone="gray" compact />
                </div>
              </Panel>
            </section>

            <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Panel title="Messages by Day">
                <div className="flex h-52 items-end gap-1">
                  {data.conversations.messages_by_day.map((day) => {
                    const total = day.inbound + day.outbound;
                    return (
                      <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <div className="flex h-44 w-full items-end rounded-sm bg-gray-100 dark:bg-gray-700">
                          <div
                            className="w-full rounded-sm bg-green-500"
                            title={`${day.date}: ${total} messages`}
                            style={{ height: `${Math.max(total === 0 ? 0 : 5, (total / maxDailyMessages) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Top Tool Calls">
                {data.conversations.top_tools.length > 0 ? (
                  <BarRows rows={data.conversations.top_tools.map((tool) => ({ label: tool.name, value: tool.count, color: "bg-slate-600" }))} />
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No tool calls in the last 30 days.</p>
                )}
              </Panel>
            </section>

            <section className="mt-6 rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 shadow-sm">
              <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                <h2 className="text-lg font-semibold">Overdue Tasks</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                  <thead className="bg-gray-50 dark:bg-gray-800/60">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Task</th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Department</th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Priority</th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {data.tasks.overdue_list.map((task) => (
                      <tr key={task.id}>
                        <td className="px-5 py-4 text-sm font-medium">{task.title}</td>
                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{task.department_name}</td>
                        <td className="px-5 py-4 text-sm capitalize text-gray-600 dark:text-gray-300">{task.priority}</td>
                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{task.due_date}</td>
                      </tr>
                    ))}
                    {data.tasks.overdue_list.length === 0 && (
                      <tr>
                        <td className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400" colSpan={4}>No overdue tasks.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function Metric({
  label,
  value,
  tone,
  compact = false,
}: {
  label: string;
  value: number;
  tone: "blue" | "red" | "amber" | "green" | "gray";
  compact?: boolean;
}) {
  const tones = {
    blue: "text-blue-700",
    red: "text-red-700",
    amber: "text-amber-700",
    green: "text-green-700",
    gray: "text-gray-700",
  };

  return (
    <div className={`rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 shadow-sm ${compact ? "p-4" : "p-5"}`}>
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-2 font-bold ${compact ? "text-2xl" : "text-3xl"} ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function BarRows({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium">{row.label}</span>
            <span className="text-gray-500 dark:text-gray-400">{row.value}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              className={`h-2 rounded-full ${row.color}`}
              style={{ width: `${Math.max(row.value === 0 ? 0 : 4, (row.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
