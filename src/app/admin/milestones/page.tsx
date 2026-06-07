"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { canManageInternalTools } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Department = { id: string; name: string };
type User = { id: string; display_name: string | null; phone_e164: string };

type TaskCount = { milestone_id: string; open_tasks: number; open_issues: number };

type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  budget: number | null;
  percent_complete: number;
  notes: string | null;
  department_id: string;
  created_by: string | null;
  departments: { name: string } | null;
  open_tasks?: number;
  open_issues?: number;
};

type MilestoneForm = {
  id?: string;
  title: string;
  description: string;
  budget: string;
  percent_complete: string;
  status: string;
  notes: string;
  department_id: string;
  assigned_to: string;
};

const emptyForm: MilestoneForm = {
  title: "", description: "", budget: "", percent_complete: "0",
  status: "open", notes: "", department_id: "", assigned_to: "",
};

export default function MilestonesPage() {
  const router = useRouter();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<MilestoneForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterDept, setFilterDept] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => {
    const user = readAdminUser();
    if (!user) { router.push("/admin/login"); return; }
    if (!canManageInternalTools(user)) { router.push("/admin/registration"); return; }
    void loadData();

  }, [router]);

  async function loadData() {
    setLoading(true);
    try {
      const [mRes, dRes, uRes, cRes] = await Promise.all([
        apiFetch("/api/milestones"),
        apiFetch("/api/departments"),
        apiFetch("/api/admin/users"),
        apiFetch("/api/milestones/task-counts"),
      ]);
      const rawMilestones: Milestone[] = mRes.ok ? await mRes.json() : [];
      if (dRes.ok) setDepartments(await dRes.json());
      if (uRes.ok) setUsers(await uRes.json());

      if (cRes.ok) {
        const counts = (await cRes.json()) as TaskCount[];
        const countMap = new Map(counts.map((c) => [c.milestone_id, c]));
        for (const m of rawMilestones) {
          const c = countMap.get(m.id);
          m.open_tasks = c?.open_tasks ?? 0;
          m.open_issues = c?.open_issues ?? 0;
        }
      }
      setMilestones(rawMilestones);
    } finally { setLoading(false); }
  }

  const filtered = milestones.filter((m) => {
    if (filterDept !== "all" && m.department_id !== filterDept) return false;
    if (filterStatus !== "all" && m.status !== filterStatus) return false;
    return true;
  });

  const totalBudget = filtered.reduce((s, m) => s + (Number(m.budget) || 0), 0);
  const avgCompletion = filtered.length > 0
    ? Math.round(filtered.reduce((s, m) => s + m.percent_complete, 0) / filtered.length)
    : 0;

  function openNew() {
    setForm({ ...emptyForm, department_id: filterDept !== "all" ? filterDept : departments[0]?.id ?? "" });
  }

  function openEdit(m: Milestone) {
    setForm({
      id: m.id, title: m.title, description: m.description ?? "",
      budget: m.budget?.toString() ?? "", percent_complete: m.percent_complete.toString(),
      status: m.status, notes: m.notes ?? "", department_id: m.department_id,
      assigned_to: m.created_by ?? "",
    });
  }

  async function saveForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    const payload = {
      title: form.title, description: form.description || null,
      budget: form.budget ? parseFloat(form.budget) : null,
      percent_complete: parseInt(form.percent_complete) || 0,
      status: form.status, notes: form.notes || null,
      department_id: form.department_id,
      assigned_to: form.assigned_to || null,
    };
    try {
      const res = form.id
        ? await apiFetch(`/api/milestones/${form.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiFetch("/api/milestones", { method: "POST", body: JSON.stringify(payload) });
      if (res.ok) { setForm(null); await loadData(); }
    } finally { setSaving(false); }
  }

  async function deleteMilestone(id: string) {
    if (!confirm("Delete this milestone? Linked tasks will be unlinked.")) return;
    const res = await apiFetch(`/api/milestones/${id}`, { method: "DELETE" });
    if (res.ok) await loadData();
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-gray-500">Loading...</p></div>;
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Milestones</p>
          <p className="text-3xl font-bold text-teal-600">{filtered.length}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Budget</p>
          <p className="text-3xl font-bold">${totalBudget.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border dark:bg-gray-900 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Completion</p>
          <p className="text-3xl font-bold text-teal-600">{avgCompletion}%</p>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm lg:flex-row lg:items-center dark:bg-gray-900 dark:border-gray-800">
        <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">
          <option value="all">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="complete">Complete</option>
        </select>
        <button onClick={openNew} className="lg:ml-auto rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">
          New Milestone
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Milestone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Department</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Budget</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Open Items</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Progress</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Status</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {filtered.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-6 py-4">
                    <button onClick={() => openEdit(m)} className="text-left font-medium text-blue-600 hover:underline dark:text-blue-400">{m.title}</button>
                    {m.description && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-1">{m.description}</p>}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{m.departments?.name ?? "—"}</td>
                  <td className="px-6 py-4 text-center">{m.budget != null ? `$${Number(m.budget).toLocaleString()}` : "—"}</td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {(m.open_tasks ?? 0) > 0 && (
                        <a href={`/admin/tasks?milestone_id=${m.id}&department_id=${m.department_id}`} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                          {m.open_tasks} task{m.open_tasks !== 1 ? "s" : ""}
                        </a>
                      )}
                      {(m.open_issues ?? 0) > 0 && (
                        <a href={`/admin/tasks?milestone_id=${m.id}&department_id=${m.department_id}&item_type=issue`} className="text-xs text-orange-600 hover:underline dark:text-orange-400">
                          {m.open_issues} issue{m.open_issues !== 1 ? "s" : ""}
                        </a>
                      )}
                      {!(m.open_tasks ?? 0) && !(m.open_issues ?? 0) && <span className="text-xs text-gray-400">—</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 rounded-full bg-gray-200 dark:bg-gray-700">
                        <div className={`h-2 rounded-full ${m.percent_complete >= 100 ? "bg-green-500" : m.percent_complete >= 50 ? "bg-teal-500" : "bg-blue-500"}`} style={{ width: `${Math.min(100, m.percent_complete)}%` }} />
                      </div>
                      <span className="text-sm">{m.percent_complete}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                      m.status === "complete" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" :
                      m.status === "blocked" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
                      m.status === "in_progress" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" :
                      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    }`}>{m.status}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button onClick={() => deleteMilestone(m.id)} className="text-sm text-red-600 hover:text-red-800 dark:text-red-400">Delete</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No milestones found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <form onSubmit={saveForm} className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{form.id ? "Edit Milestone" : "New Milestone"}</h3>
              <button type="button" onClick={() => setForm(null)} className="text-gray-500 hover:text-gray-800">Close</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2 text-sm font-medium">
                Title
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="sm:col-span-2 text-sm font-medium">
                Description
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm font-medium">
                Department
                <select required value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                  <option value="">Select department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                Assigned To
                <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.display_name ?? u.phone_e164}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                Budget ($)
                <input type="number" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm font-medium">
                % Complete
                <input type="number" min="0" max="100" value={form.percent_complete} onChange={(e) => setForm({ ...form, percent_complete: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm font-medium">
                Status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="complete">Complete</option>
                </select>
              </label>
              <label className="sm:col-span-2 text-sm font-medium">
                Notes
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setForm(null)} className="rounded-md px-4 py-2 text-gray-600 hover:text-gray-900">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
