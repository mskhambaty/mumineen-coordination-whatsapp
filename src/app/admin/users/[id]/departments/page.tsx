"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

type Membership = {
  id: string;
  department_id: string;
  dept_role: string;
  is_active: boolean;
  department_name: string;
};

type Department = { id: string; name: string };

export default function UserDepartmentsPage() {
  const router = useRouter();
  const params = useParams();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);
  const [newDept, setNewDept] = useState("");
  const [newRole, setNewRole] = useState("member");

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    async function loadData() {
      try {
        const headers = { "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "" };
        const [membRes, deptRes, userRes] = await Promise.all([
          fetch(`/api/admin/users/${params.id}/departments`, { headers }),
          fetch("/api/departments", { headers }),
          fetch(`/api/admin/users/${params.id}`, { headers }),
        ]);

        if (membRes.ok) setMemberships(await membRes.json());
        if (deptRes.ok) setDepartments(await deptRes.json());
        if (userRes.ok) {
          const user = await userRes.json();
          setUserName(user.display_name ?? "User");
        }
      } catch (err) {
        console.error("Failed to fetch:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, params.id]);

  async function addMembership(e: React.FormEvent) {
    e.preventDefault();
    if (!newDept) return;
    try {
      await fetch(`/api/admin/users/${params.id}/departments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "",
        },
        body: JSON.stringify({ department_id: newDept, dept_role: newRole }),
      });
      setNewDept("");
      setNewRole("member");
      window.location.reload();
    } catch (err) {
      console.error("Failed to add membership:", err);
    }
  }

  async function deactivateMembership(id: string) {
    try {
      await fetch(`/api/admin/users/${params.id}/departments/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "",
        },
        body: JSON.stringify({ is_active: false }),
      });
      window.location.reload();
    } catch (err) {
      console.error("Failed to deactivate:", err);
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
              <Link href="/admin/users" className="text-blue-600 hover:underline">← Users</Link>
              <h1 className="text-xl font-bold text-gray-900">{userName} — Departments</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Current Memberships */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-8">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Current Memberships</h2>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {memberships.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-4 text-center text-gray-500">No department memberships</td></tr>
              ) : (
                memberships.map((m) => (
                  <tr key={m.id}>
                    <td className="px-6 py-4">{m.department_name}</td>
                    <td className="px-6 py-4 text-sm">{m.dept_role.toUpperCase()}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs ${m.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {m.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {m.is_active && (
                        <button onClick={() => deactivateMembership(m.id)} className="text-red-600 text-sm hover:underline">
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Add Membership */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4">Add Membership</h3>
          <form onSubmit={addMembership} className="flex space-x-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">Department</label>
              <select value={newDept} onChange={(e) => setNewDept(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                <option value="">Select...</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Role</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                <option value="member">Member</option>
                <option value="pm">PM</option>
                <option value="hod">HOD</option>
              </select>
            </div>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">Add</button>
          </form>
        </div>
      </main>
    </div>
  );
}
