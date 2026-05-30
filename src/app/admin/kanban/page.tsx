"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string | null;
  source: string;
  due_date: string | null;
  department_id: string;
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
  low: "bg-gray-100 text-gray-700 border-gray-200",
};

const emptyForm: TaskForm = {
  title: "",
  description: "",
  status: "open",
  priority: "medium",
  department_id: "",
  assigned_to: "",
  due_date: "",
};

export default function KanbanPage() {
  const router = useRouter();
  const [board, setBoard] = useState<Board>({ open: [], in_progress: [], blocked: [], complete: [] });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [departmentId, setDepartmentId] = useState("all");
  const [priority, setPriority] = useState("all");
  const [assigneeId, setAssigneeId] = useState("all");
  const [includeComplete, setIncludeComplete] = useState(false);
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
  }, [departmentId, priority, assigneeId, includeComplete]);

  const totalOpen = useMemo(
    () => board.open.length + board.in_progress.length + board.blocked.length,
    [board],
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
    const [deptRes, usersRes] = await Promise.all([
      apiFetch("/api/departments"),
      apiFetch("/api/admin/users"),
    ]);

    if (deptRes.ok) setDepartments(await deptRes.json() as Department[]);
    if (usersRes.ok) setUsers(await usersRes.json() as User[]);
  }

  async function loadBoard() {
    setLoading(true);
    const params = new URLSearchParams();
    if (departmentId !== "all") params.set("department_id", departmentId);
    if (priority !== "all") params.set("priority", priority);
    if (assigneeId !== "all") params.set("assignee_id", assigneeId);
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

  async function updateTask(task: Task, updates: Partial<Pick<Task, "status" | "priority">>) {
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
      department_id: task.department_id,
      assigned_to: task.assigned_to ?? "",
      due_date: task.due_date ?? "",
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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold">Kanban Board</h1>
            <div className="flex space-x-4">
              <Link href="/admin" className="text-gray-600 hover:text-blue-600">Home</Link>
              <Link href="/admin/kanban" className="text-blue-600 font-medium">Kanban</Link>
              <Link href="/admin/upload" className="text-gray-600 hover:text-blue-600">Upload</Link>
              <Link href="/admin/users" className="text-gray-600 hover:text-blue-600">Users</Link>
              <button onClick={() => { localStorage.clear(); router.push("/admin/login"); }} className="text-gray-600 hover:text-red-600">
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-5 flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm lg:flex-row lg:items-center">
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="rounded-md border px-3 py-2 text-sm">
            <option value="all">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-md border px-3 py-2 text-sm">
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="rounded-md border px-3 py-2 text-sm">
            <option value="all">All assignees</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.display_name ?? user.phone_e164}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!includeComplete} onChange={(event) => setIncludeComplete(!event.target.checked)} />
            Show only open
          </label>
          <div className="lg:ml-auto text-sm text-gray-500">{totalOpen} active tasks</div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-500">Loading board...</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-4">
            {statuses.map((column) => (
              <section key={column.id} className="min-h-[28rem] rounded-lg border bg-white">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h2 className="font-semibold">{column.label}</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{board[column.id].length}</span>
                </div>
                <div className="space-y-3 p-3">
                  {board[column.id].map((task) => (
                    <article key={task.id} className="rounded-md border bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => openEditTask(task)} className="text-left font-medium text-gray-900 hover:text-blue-700">
                          {task.title}
                        </button>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${priorityClasses[task.priority]}`}>
                          {task.priority}
                        </span>
                      </div>
                      {task.description && <p className="mt-2 line-clamp-2 text-sm text-gray-600">{task.description}</p>}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                        <span className="rounded bg-gray-100 px-2 py-1">{task.departments?.name ?? "Department"}</span>
                        <span className="rounded bg-gray-100 px-2 py-1">{task.source}</span>
                      </div>
                      <div className="mt-3 text-sm text-gray-600">
                        <div>{task.assignee?.display_name ?? "Unassigned"}</div>
                        <div className={isOverdue(task) ? "font-medium text-red-600" : "text-gray-500"}>
                          {task.due_date ? `Due ${task.due_date}` : "No due date"}
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <select value={task.status} onChange={(event) => updateTask(task, { status: event.target.value as TaskStatus })} className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs">
                          {statuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                        </select>
                        <button onClick={() => archiveTask(task)} className="rounded-md border px-2 py-1 text-xs text-gray-600 hover:border-red-200 hover:text-red-600">
                          Archive
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

      <button onClick={openNewTask} className="fixed bottom-6 right-6 rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-blue-700">
        New Task
      </button>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <form onSubmit={saveTask} className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{form.id ? "Edit Task" : "New Task"}</h3>
              <button type="button" onClick={() => setForm(null)} className="text-gray-500 hover:text-gray-800">Close</button>
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
                Due Date
                <input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setForm(null)} className="rounded-md px-4 py-2 text-gray-600 hover:text-gray-900">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function isOverdue(task: Task) {
  if (!task.due_date || task.status === "complete") return false;
  return task.due_date < new Date().toISOString().split("T")[0];
}
