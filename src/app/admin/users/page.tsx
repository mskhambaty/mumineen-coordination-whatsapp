"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type User = {
  id: string;
  display_name: string | null;
  phone_e164: string;
  email: string | null;
  role: string;
  global_role: string;
  status: string;
};

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ display_name: "", phone_e164: "", email: "", global_role: "member" });

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    async function loadUsers() {
      try {
        const res = await fetch("/api/admin/users", {
          headers: { "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "" },
        });
        if (res.ok) {
          setUsers(await res.json());
        }
      } catch (err) {
        console.error("Failed to fetch users:", err);
      } finally {
        setLoading(false);
      }
    }

    loadUsers();
  }, [router]);

  async function updateUser(id: string, field: string, value: string) {
    try {
      await fetch(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "",
        },
        body: JSON.stringify({ [field]: value }),
      });
      window.location.reload();
    } catch (err) {
      console.error("Failed to update user:", err);
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "",
        },
        body: JSON.stringify(newUser),
      });
      setShowAddUser(false);
      setNewUser({ display_name: "", phone_e164: "", email: "", global_role: "member" });
      window.location.reload();
    } catch (err) {
      console.error("Failed to add user:", err);
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
              <Link href="/admin/conversations" className="text-gray-600 hover:text-blue-600">Inbox</Link>
              <Link href="/admin/analytics" className="text-gray-600 hover:text-blue-600">Analytics</Link>
              <h1 className="text-xl font-bold text-gray-900">User Management</h1>
            </div>
            <button
              onClick={() => setShowAddUser(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
            >
              Add User
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Add User Modal */}
        {showAddUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Add User</h3>
              <form onSubmit={addUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Display Name *</label>
                  <input type="text" required value={newUser.display_name} onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Phone (E.164) *</label>
                  <input type="text" required value={newUser.phone_e164} onChange={(e) => setNewUser({ ...newUser, phone_e164: e.target.value })} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="+1234567890" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Email</label>
                  <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Global Role</label>
                  <select value={newUser.global_role} onChange={(e) => setNewUser({ ...newUser, global_role: e.target.value })} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                    <option value="member">Member</option>
                    <option value="pm">PM</option>
                    <option value="hod">HOD</option>
                    <option value="leadership_admin">Leadership / Admin</option>
                  </select>
                </div>
                <div className="flex justify-end space-x-3">
                  <button type="button" onClick={() => setShowAddUser(false)} className="px-4 py-2 text-gray-600">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Add</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Display Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Global Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium">{user.display_name ?? "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{user.phone_e164}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{user.email ?? "—"}</td>
                    <td className="px-6 py-4 text-sm">{user.role}</td>
                    <td className="px-6 py-4">
                      <select
                        value={user.global_role}
                        onChange={(e) => updateUser(user.id, "global_role", e.target.value)}
                        className="text-sm border rounded px-2 py-1"
                      >
                        <option value="member">Member</option>
                        <option value="pm">PM</option>
                        <option value="hod">HOD</option>
                        <option value="leadership_admin">Leadership / Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={user.status}
                        onChange={(e) => updateUser(user.id, "status", e.target.value)}
                        className="text-sm border rounded px-2 py-1"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/admin/users/${user.id}/departments`} className="text-blue-600 text-sm hover:underline">
                        Departments
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Permission Matrix */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Permission Matrix</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Member</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">PM</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">HOD</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Leadership / Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {[
                  ["View own dept tasks", true, true, true, true],
                  ["View ALL dept tasks", false, false, false, true],
                  ["Create tasks (own dept)", false, true, true, true],
                  ["Update task status (own dept)", false, true, true, true],
                  ["Update ANY dept tasks", false, false, false, true],
                  ["Get dept summary (own)", true, true, true, true],
                  ["Get ALL depts summary", false, false, false, true],
                  ["Upload transcripts", false, true, true, true],
                  ["Manage users & members", false, false, false, true],
                ].map(([action, member, pm, hod, admin], i) => (
                  <tr key={i}>
                    <td className="px-6 py-3 text-sm text-gray-700">{action as string}</td>
                    <td className="px-6 py-3 text-center">{member ? "✅" : "❌"}</td>
                    <td className="px-6 py-3 text-center">{pm ? "✅" : "❌"}</td>
                    <td className="px-6 py-3 text-center">{hod ? "✅" : "❌"}</td>
                    <td className="px-6 py-3 text-center">{admin ? "✅" : "❌"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
