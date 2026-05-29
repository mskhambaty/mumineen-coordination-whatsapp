"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  due_date: string | null;
  source: string;
  updated_at: string;
  assignee: { display_name: string } | null;
};

const statusColors: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  blocked: "bg-red-100 text-red-700",
  complete: "bg-green-100 text-green-700",
};

export default function DepartmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deptName, setDeptName] = useState("");
  const [loading, setLoading] = useState(true);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", description: "", assigned_to_alias: "", due_date: "" });

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    async function loadTasks() {
      try {
        const res = await fetch(`/api/departments/${params.id}/tasks`, {
          headers: { "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "" },
        });
        if (res.ok) {
          const data = await res.json();
          setTasks(data);
        }
        // Get department name
        const deptRes = await fetch("/api/departments", {
          headers: { "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "" },
        });
        if (deptRes.ok) {
          const depts = await deptRes.json();
          const dept = depts.find((d: { id: string; name: string }) => d.id === params.id);
          if (dept) setDeptName(dept.name);
        }
      } catch (err) {
        console.error("Failed to fetch tasks:", err);
      } finally {
        setLoading(false);
      }
    }

    loadTasks();
  }, [router, params.id]);

  async function updateTaskStatus(taskId: string, status: string) {
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "",
        },
        body: JSON.stringify({ status }),
      });
      window.location.reload();
    } catch (err) {
      console.error("Failed to update task:", err);
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "",
        },
        body: JSON.stringify({
          title: newTask.title,
          department_name: deptName,
          description: newTask.description || undefined,
          assigned_to_alias: newTask.assigned_to_alias || undefined,
          due_date: newTask.due_date || undefined,
          source: "manual",
        }),
      });
      setShowNewTask(false);
      setNewTask({ title: "", description: "", assigned_to_alias: "", due_date: "" });
      window.location.reload();
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-4">
              <Link href="/admin" className="text-blue-600 hover:underline">← Dashboard</Link>
              <h1 className="text-xl font-bold text-gray-900">{deptName}</h1>
            </div>
            <button
              onClick={() => setShowNewTask(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
            >
              New Task
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* New Task Modal */}
        {showNewTask && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">New Task</h3>
              <form onSubmit={createTask} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Title *</label>
                  <input
                    type="text"
                    required
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Description</label>
                  <textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Assign To</label>
                  <input
                    type="text"
                    value={newTask.assigned_to_alias}
                    onChange={(e) => setNewTask({ ...newTask, assigned_to_alias: e.target.value })}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Person's name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Due Date</label>
                  <input
                    type="date"
                    value={newTask.due_date}
                    onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button type="button" onClick={() => setShowNewTask(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Create</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tasks Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned To</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">No tasks yet</td>
                  </tr>
                ) : (
                  tasks.map((task) => (
                    <tr key={task.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">{task.title}</td>
                      <td className="px-6 py-4">
                        <select
                          value={task.status}
                          onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                          className={`px-2 py-1 rounded text-xs font-medium ${statusColors[task.status] ?? ""}`}
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="blocked">Blocked</option>
                          <option value="complete">Complete</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{task.assignee?.display_name ?? "—"}</td>
                      <td className="px-6 py-4 text-gray-600">{task.due_date ?? "—"}</td>
                      <td className="px-6 py-4 text-gray-500 text-sm">{task.source}</td>
                      <td className="px-6 py-4 text-gray-500 text-sm">{new Date(task.updated_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
