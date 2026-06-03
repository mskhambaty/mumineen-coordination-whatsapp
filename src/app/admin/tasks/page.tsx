"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

type TaskStatus = "open" | "in_progress" | "blocked" | "complete";
type TaskPriority = "low" | "medium" | "high";

type Department = {
  id: string;
  name: string;
};

type User = {
  id: string;
  display_name: string | null;
  phone_e164: string;
};

type Milestone = {
  id: string;
  title: string;
  department_id: string;
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string | null;
  source: string;
  due_date: string | null;
  department_id: string | null;
  milestone_id?: string | null;
  item_type?: string;
  origin?: string | null;
  source_phone?: string | null;
  created_at: string;
  updated_at: string;
  departments?: { name: string } | null;
  assignee?: { display_name: string | null } | null;
};

type Board = Record<TaskStatus, Task[]>;

type TaskForm = {
  id?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  department_id: string;
  assigned_to: string;
  due_date: string;
  item_type: string;
  milestone_id: string;
};

const statuses: { id: TaskStatus; label: string }[] = [
  { id: "open", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "complete", label: "Done" },
];

const priorityClasses: Record<TaskPriority, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200",
};

const emptyForm: TaskForm = {
  title: "",
  description: "",
  status: "open",
  priority: "medium",
  department_id: "",
  assigned_to: "",
  due_date: "",
  item_type: "task",
  milestone_id: "",
};

export default function KanbanPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><p className="text-gray-500">Loading...</p></div>}>
      <KanbanPage />
    </Suspense>
  );
}

function KanbanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [board, setBoard] = useState<Board>({ open: [], in_progress: [], blocked: [], complete: [] });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [departmentId, setDepartmentId] = useState(searchParams.get("department_id") ?? "all");
  const [milestoneId, setMilestoneId] = useState(searchParams.get("milestone_id") ?? "all");
  const [priority, setPriority] = useState("all");
  const [assigneeId, setAssigneeId] = useState("all");
  const [includeComplete, setIncludeComplete] = useState(false);
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [itemType, setItemType] = useState(searchParams.get("item_type") ?? "all");
  const [origin, setOrigin] = useState(searchParams.get("origin") ?? "all");
  const [form, setForm] = useState<TaskForm | null>(null);
  const [saving, setSaving] = useState(false);

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    void loadReferenceData();
    void loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    void loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, milestoneId, priority, assigneeId, includeComplete, itemType, origin]);

  const filteredBoard = useMemo((): Board => {
    if (!showOverdueOnly) return board;
    const today = new Date().toISOString().split("T")[0];
    const filterOverdue = (tasks: Task[]) => tasks.filter((t) => t.due_date && t.due_date < today && t.status !== "complete");
    return {
      open: filterOverdue(board.open),
      in_progress: filterOverdue(board.in_progress),
      blocked: filterOverdue(board.blocked),
      complete: [],
    };
  }, [board, showOverdueOnly]);

  const totalOpen = useMemo(
    () => filteredBoard.open.length + filteredBoard.in_progress.length + filteredBoard.blocked.length,
    [filteredBoard],
  );

  const filteredMilestones = useMemo(
    () => departmentId === "all" ? milestones : milestones.filter((m) => m.department_id === departmentId),
    [milestones, departmentId],
  );

  async function apiFetch(path: string, init?: RequestInit) {
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
        ...(init?.headers ?? {}),
      },
    });
  }

  async function loadReferenceData() {
    const [deptRes, usersRes, msRes] = await Promise.all([
      apiFetch("/api/departments"),
      apiFetch("/api/admin/users"),
      apiFetch("/api/milestones"),
    ]);

    if (deptRes.ok) setDepartments(await deptRes.json() as Department[]);
    if (usersRes.ok) setUsers(await usersRes.json() as User[]);
    if (msRes.ok) setMilestones(await msRes.json() as Milestone[]);
  }

  async function loadBoard() {
    setLoading(true);
    const params = new URLSearchParams();
    if (departmentId !== "all") params.set("department_id", departmentId);
    if (milestoneId !== "all") params.set("milestone_id", milestoneId);
    if (priority !== "all") params.set("priority", priority);
    if (assigneeId !== "all") params.set("assignee_id", assigneeId);
    if (itemType !== "all") params.set("item_type", itemType);
    if (origin !== "all") params.set("origin", origin);
    if (includeComplete) params.set("include_complete", "true");

    try {
      const res = await apiFetch(`/api/tasks/kanban?${params.toString()}`);
      if (res.ok) {
        setBoard(await res.json() as Board);
      }
    } finally {
      setLoading(false);
    }
  }

  async function updateTask(task: Task, updates: Partial<Pick<Task, "status" | "priority" | "assigned_to">>) {
    const res = await apiFetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    if (res.ok) await loadBoard();
  }

  function openNewTask() {
    setForm({
      ...emptyForm,
      department_id: departmentId !== "all" ? departmentId : departments[0]?.id ?? "",
    });
  }

  function openEditTask(task: Task) {
    setForm({
      id: task.id,
      title: task.title,
      description: task.description ?? "",
      status: task.status,
      priority: task.priority,
      department_id: task.department_id ?? "",
      assigned_to: task.assigned_to ?? "",
      due_date: task.due_date ?? "",
      item_type: task.item_type ?? "task",
      milestone_id: task.milestone_id ?? "",
    });
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);

    const payload = {
      title: form.title,
      description: form.description || null,
      status: form.status,
      priority: form.priority,
      department_id: form.department_id,
      assigned_to: form.assigned_to || null,
      due_date: form.due_date || null,
      item_type: form.item_type || "task",
      milestone_id: form.milestone_id || null,
      source: "manual",
    };

    try {
      const res = form.id
        ? await apiFetch(`/api/tasks/${form.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiFetch("/api/tasks", { method: "POST", body: JSON.stringify(payload) });

      if (res.ok) {
        setForm(null);
        await loadBoard();
      }
    } finally {
      setSaving(false);
    }
  }

  async function archiveTask(task: Task) {
    const res = await apiFetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "complete", archived: true }),
    });
    if (res.ok) await loadBoard();
  }

  async function deleteTask(task: Task) {
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    const res = await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (res.ok) await loadBoard();
  }

  return (
    <>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-center">
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
            <option value="all">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
            <option value="all">All assignees</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.display_name ?? user.phone_e164}</option>
            ))}
          </select>
          <select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
            <option value="all">All milestones</option>
            {filteredMilestones.map((ms) => <option key={ms.id} value={ms.id}>{ms.title}</option>)}
          </select>
          <select value={itemType} onChange={(event) => setItemType(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
            <option value="all">All types</option>
            <option value="task">Tasks only</option>
            <option value="issue">Issues only</option>
          </select>
          <select value={origin} onChange={(event) => setOrigin(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
            <option value="all">All origins</option>
            <option value="external">External</option>
            <option value="internal">Internal</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={!includeComplete} onChange={(event) => setIncludeComplete(!event.target.checked)} />
            Show only open
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={showOverdueOnly} onChange={(event) => setShowOverdueOnly(event.target.checked)} />
            Overdue only
          </label>
          <div className="lg:ml-auto text-sm text-gray-500 dark:text-gray-400">{totalOpen} active tasks</div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-500 dark:text-gray-400">Loading board...</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-4">
            {statuses.map((column) => (
              <section key={column.id} className="min-h-[28rem] rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center justify-between border-b px-4 py-3 dark:border-gray-800">
                  <h2 className="font-semibold">{column.label}</h2>
                  <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-1 text-xs text-gray-600 dark:text-gray-300">{filteredBoard[column.id].length}</span>
                </div>
                <div className="space-y-3 p-3">
                  {filteredBoard[column.id].map((task) => (
                    <article key={task.id} className="rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => openEditTask(task)} className="text-left font-medium text-gray-900 dark:text-gray-100 hover:text-blue-700">
                          {task.title}
                        </button>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${priorityClasses[task.priority]}`}>
                          {task.priority}
                        </span>
                      </div>
                      {task.description && <p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-gray-300">{task.description}</p>}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="rounded bg-gray-100 dark:bg-gray-700 px-2 py-1">{task.departments?.name ?? "No department"}</span>
                        <span className="rounded bg-gray-100 dark:bg-gray-700 px-2 py-1">{task.source}</span>
                        {task.item_type === "issue" && (
                          <span className="rounded bg-orange-100 px-2 py-1 font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">Issue</span>
                        )}
                        {task.item_type === "issue" && (
                          <span className={`rounded px-2 py-1 font-medium ${task.origin === "external" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"}`}>
                            {task.origin === "external" ? "External" : "Internal"}
                          </span>
                        )}
                        {task.source_phone && (
                          <a
                            href={`/admin/conversations?phone=${encodeURIComponent(task.source_phone)}`}
                            className="rounded bg-blue-100 px-2 py-1 font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
                            title="Open the WhatsApp conversation this came from"
                          >
                            View chat ↗
                          </a>
                        )}
                      </div>
                      <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                        <select
                          value={task.assigned_to ?? ""}
                          onChange={(event) => updateTask(task, { assigned_to: event.target.value || null })}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                          title="Assignee"
                        >
                          <option value="">Unassigned</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>{user.display_name ?? user.phone_e164}</option>
                          ))}
                        </select>
                        <div className={`mt-1 ${isOverdue(task) ? "font-medium text-red-600" : "text-gray-500 dark:text-gray-400"}`}>
                          {task.due_date ? `Due ${task.due_date}` : "No due date"}
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <select value={task.status} onChange={(event) => updateTask(task, { status: event.target.value as TaskStatus })} className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
                          {statuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                        </select>
                        <button onClick={() => archiveTask(task)} className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-green-200 hover:text-green-600">
                          Close
                        </button>
                        <button onClick={() => deleteTask(task)} className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-red-200 hover:text-red-600">
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <div className="fixed bottom-6 right-6 flex gap-3">
        <button onClick={() => { setForm({ ...emptyForm, item_type: "issue", department_id: departmentId !== "all" ? departmentId : departments[0]?.id ?? "" }); }} className="rounded-full bg-orange-600 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-orange-700">
          New Issue
        </button>
        <button onClick={openNewTask} className="rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-blue-700">
          New Task
        </button>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <form onSubmit={saveTask} className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{form.id ? "Edit" : "New"} {form.item_type === "issue" ? "Issue" : "Task"}</h3>
              <button type="button" onClick={() => setForm(null)} className="text-gray-500 dark:text-gray-400 hover:text-gray-800">Close</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2 text-sm font-medium">
                Title
                <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" />
              </label>
              <label className="sm:col-span-2 text-sm font-medium">
                Description
                <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="mt-1 w-full rounded-md border px-3 py-2" />
              </label>
              <label className="text-sm font-medium">
                Department
                <select required value={form.department_id} onChange={(event) => setForm({ ...form, department_id: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2">
                  <option value="">Select department</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                Assignee
                <select value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2">
                  <option value="">Unassigned</option>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.display_name ?? user.phone_e164}</option>)}
                </select>
              </label>
              <label className="sm:col-span-2 text-sm font-medium">
                Milestone
                <select value={form.milestone_id} onChange={(event) => setForm({ ...form, milestone_id: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2">
                  <option value="">No milestone</option>
                  {milestones.filter((ms) => !form.department_id || ms.department_id === form.department_id).map((ms) => <option key={ms.id} value={ms.id}>{ms.title}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                Status
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })} className="mt-1 w-full rounded-md border px-3 py-2">
                  {statuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                Priority
                <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriority })} className="mt-1 w-full rounded-md border px-3 py-2">
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Type
                <select value={form.item_type} onChange={(event) => setForm({ ...form, item_type: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2">
                  <option value="task">Task</option>
                  <option value="issue">Issue</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Due Date
                <input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setForm(null)} className="rounded-md px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function isOverdue(task: Task) {
  if (!task.due_date || task.status === "complete") return false;
  return task.due_date < new Date().toISOString().split("T")[0];
}
