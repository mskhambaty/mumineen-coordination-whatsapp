"use client";

import { useEffect, useMemo, useState } from "react";
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
  department_membership_id?: string | null;
  department_role?: string | null;
};

type Department = {
  id: string;
  name: string;
};

type UserForm = {
  display_name: string;
  phone_e164: string;
  email: string;
  role: string;
  global_role: string;
  status: string;
};

type DepartmentMembership = {
  id: string;
  department_id: string;
  dept_role: string;
  is_active: boolean;
};

const USER_ROLE_OPTIONS = [
  { value: "committee", label: "Committee" },
  { value: "admin", label: "Admin / Leadership" },
  { value: "visitor", label: "Visitor" },
];

const GLOBAL_ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "pm", label: "PM" },
  { value: "hod", label: "HOD" },
  { value: "leadership_admin", label: "Leadership / Admin" },
];

const DEPT_ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "pm", label: "PM" },
  { value: "hod", label: "HOD" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ display_name: "", phone_e164: "", email: "", role: "committee", global_role: "member" });
  const [newUserDeptRole, setNewUserDeptRole] = useState("member");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UserForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [existingUserId, setExistingUserId] = useState("");
  const [existingUserDeptRole, setExistingUserDeptRole] = useState("member");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingExisting, setAddingExisting] = useState(false);
  const [currentUserId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const userRaw = window.localStorage.getItem("admin_user");
    if (!userRaw) return null;
    try {
      const user = JSON.parse(userRaw) as { id?: string };
      return user.id ?? null;
    } catch {
      return null;
    }
  });
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";
  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId) ?? null;
  const usersInSelectedDepartment = new Set(users.map((user) => user.id));
  const addableUsers = allUsers.filter((user) => !usersInSelectedDepartment.has(user.id));
  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return users;

    return users.filter((user) =>
      [
        user.display_name,
        user.phone_e164,
        user.email,
        user.role,
        user.global_role,
        user.department_role,
        user.status,
      ].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [searchQuery, users]);

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (selectedDepartmentId !== "all") params.set("department_id", selectedDepartmentId);

        const [usersRes, departmentsRes, allUsersRes] = await Promise.all([
          fetch(`/api/admin/users?${params.toString()}`, {
            headers: { "x-admin-key": adminKey },
          }),
          fetch("/api/departments", {
            headers: { "x-admin-key": adminKey },
          }),
          selectedDepartmentId === "all"
            ? Promise.resolve(null)
            : fetch("/api/admin/users", {
                headers: { "x-admin-key": adminKey },
              }),
        ]);

        if (!usersRes.ok) {
          const data = await usersRes.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Failed to fetch users");
        }
        const fetchedUsers = await usersRes.json() as User[];
        setUsers(fetchedUsers);

        if (selectedDepartmentId === "all") {
          setAllUsers(fetchedUsers);
        } else if (allUsersRes?.ok) {
          setAllUsers(await allUsersRes.json() as User[]);
        }

        if (departmentsRes.ok) {
          setDepartments(await departmentsRes.json() as Department[]);
        }
      } catch (err) {
        console.error("Failed to fetch users:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch users");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [adminKey, router, selectedDepartmentId]);

  async function updateUser(id: string, field: string, value: string) {
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to update user");
      }
      const updated = await res.json() as User;
      setUsers((items) => items.map((user) => user.id === id ? { ...user, ...updated } : user));
      setAllUsers((items) => items.map((user) => user.id === id ? { ...user, ...updated } : user));
    } catch (err) {
      console.error("Failed to update user:", err);
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify(newUser),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to add user");
      }
      const created = await res.json() as User;
      let createdForList = created;

      if (selectedDepartmentId !== "all") {
        const membership = await addMembership(created.id, selectedDepartmentId, newUserDeptRole);
        createdForList = {
          ...created,
          department_membership_id: membership.id,
          department_role: membership.dept_role,
        };
      }

      setShowAddUser(false);
      setNewUser({ display_name: "", phone_e164: "", email: "", role: "committee", global_role: "member" });
      setNewUserDeptRole("member");
      setAllUsers((items) => [...items, created].sort(sortUsers));
      setUsers((items) => [...items, createdForList].sort(sortUsers));
    } catch (err) {
      console.error("Failed to add user:", err);
      setError(err instanceof Error ? err.message : "Failed to add user");
    }
  }

  async function addExistingUser(e: React.FormEvent) {
    e.preventDefault();
    if (selectedDepartmentId === "all" || !existingUserId) return;

    setAddingExisting(true);
    setError(null);
    try {
      const membership = await addMembership(existingUserId, selectedDepartmentId, existingUserDeptRole);
      const user = allUsers.find((item) => item.id === existingUserId);
      if (user) {
        setUsers((items) => [
          ...items,
          {
            ...user,
            department_membership_id: membership.id,
            department_role: membership.dept_role,
          },
        ].sort(sortUsers));
      }
      setExistingUserId("");
      setExistingUserDeptRole("member");
    } catch (err) {
      console.error("Failed to add existing user to department:", err);
      setError(err instanceof Error ? err.message : "Failed to add user to department");
    } finally {
      setAddingExisting(false);
    }
  }

  async function addMembership(userId: string, departmentId: string, deptRole: string): Promise<DepartmentMembership> {
    const res = await fetch(`/api/admin/users/${userId}/departments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify({ department_id: departmentId, dept_role: deptRole }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? "Failed to add department membership");
    }

    return await res.json() as DepartmentMembership;
  }

  function openEditUser(user: User) {
    setEditingUser(user);
    setEditForm({
      display_name: user.display_name ?? "",
      phone_e164: user.phone_e164,
      email: user.email ?? "",
      role: user.role,
      global_role: user.global_role,
      status: user.status,
    });
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !editForm) return;

    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          display_name: editForm.display_name,
          phone_e164: editForm.phone_e164,
          email: editForm.email || null,
          role: editForm.role,
          global_role: editForm.global_role,
          status: editForm.status,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to save user");
      }

      const updated = await res.json() as User;
      setUsers((items) => items.map((user) => user.id === updated.id ? { ...user, ...updated } : user));
      setAllUsers((items) => items.map((user) => user.id === updated.id ? { ...user, ...updated } : user));
      setEditingUser(null);
      setEditForm(null);
    } catch (err) {
      console.error("Failed to save user:", err);
      setError(err instanceof Error ? err.message : "Failed to save user");
    } finally {
      setSavingEdit(false);
    }
  }

  async function updateDepartmentRole(user: User, deptRole: string) {
    if (!selectedDepartment || !user.department_membership_id) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}/departments/${user.department_membership_id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ dept_role: deptRole }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to update department role");
      }

      setUsers((items) => items.map((item) => item.id === user.id ? { ...item, department_role: deptRole } : item));
    } catch (err) {
      console.error("Failed to update department role:", err);
      setError(err instanceof Error ? err.message : "Failed to update department role");
    }
  }

  async function deleteUser(user: User) {
    if (user.id === currentUserId) {
      setError("You cannot delete your own signed-in user.");
      return;
    }

    const label = user.display_name || user.email || user.phone_e164;
    if (!window.confirm(`Delete ${label}? This removes their department memberships and portal access.`)) {
      return;
    }

    setDeletingId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
        headers: { "x-admin-key": adminKey },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to delete user");
      }
      setUsers((items) => items.filter((item) => item.id !== user.id));
      setAllUsers((items) => items.filter((item) => item.id !== user.id));
    } catch (err) {
      console.error("Failed to delete user:", err);
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeletingId(null);
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
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

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
                  <label className="block text-sm font-medium text-gray-700">Account Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => {
                      const role = e.target.value;
                      setNewUser({
                        ...newUser,
                        role,
                        global_role: role === "admin" ? "leadership_admin" : newUser.global_role,
                      });
                    }}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    {USER_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Global Role</label>
                  <select value={newUser.global_role} onChange={(e) => setNewUser({ ...newUser, global_role: e.target.value })} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                    {GLOBAL_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                {selectedDepartment && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Department Role in {selectedDepartment.name}</label>
                    <select value={newUserDeptRole} onChange={(e) => setNewUserDeptRole(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                      {DEPT_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex justify-end space-x-3">
                  <button type="button" onClick={() => setShowAddUser(false)} className="px-4 py-2 text-gray-600">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Add</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {editingUser && editForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg">
              <h3 className="text-lg font-semibold mb-4">Edit User</h3>
              <form onSubmit={saveUser} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Display Name
                    <input
                      type="text"
                      value={editForm.display_name}
                      onChange={(event) => setEditForm({ ...editForm, display_name: event.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    Phone (E.164)
                    <input
                      type="text"
                      required
                      value={editForm.phone_e164}
                      onChange={(event) => setEditForm({ ...editForm, phone_e164: event.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </label>
                </div>
                <label className="block text-sm font-medium text-gray-700">
                  Email
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Account Role
                    <select
                      value={editForm.role}
                      onChange={(event) => {
                        const role = event.target.value;
                        setEditForm({
                          ...editForm,
                          role,
                          global_role: role === "admin" ? "leadership_admin" : editForm.global_role,
                        });
                      }}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      {USER_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    Global Role
                    <select
                      value={editForm.global_role}
                      onChange={(event) => setEditForm({ ...editForm, global_role: event.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      {GLOBAL_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    Status
                    <select
                      value={editForm.status}
                      onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingUser(null);
                      setEditForm(null);
                    }}
                    className="px-4 py-2 text-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {savingEdit ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {selectedDepartment && (
          <div className="mb-6 rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900">Add to {selectedDepartment.name}</h2>
                <p className="text-sm text-gray-500">Choose an existing user or create a new user with this department already assigned.</p>
              </div>
              <form onSubmit={addExistingUser} className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_140px_auto] md:items-end">
                <label className="text-sm text-gray-700">
                  Existing User
                  <select
                    value={existingUserId}
                    onChange={(event) => setExistingUserId(event.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select user...</option>
                    {addableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.display_name || user.phone_e164}{user.email ? ` (${user.email})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-gray-700">
                  Role
                  <select
                    value={existingUserDeptRole}
                    onChange={(event) => setExistingUserDeptRole(event.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    {DEPT_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={!existingUserId || addingExisting}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {addingExisting ? "Adding..." : "Add"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-8">
          <div className="flex flex-col gap-3 border-b px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Users</h2>
              <p className="text-sm text-gray-500">{filteredUsers.length} of {users.length} users shown</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-gray-700 md:min-w-72">
                Search
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Name, phone, email, role..."
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700 md:min-w-72">
                Department
                <select
                  value={selectedDepartmentId}
                  onChange={(event) => {
                    setSelectedDepartmentId(event.target.value);
                    setExistingUserId("");
                  }}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="all">All departments</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Display Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Global Role</th>
                  {selectedDepartment && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dept Role</th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium">{user.display_name ?? "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{user.phone_e164}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{user.email ?? "—"}</td>
                    <td className="px-6 py-4">
                      <select
                        value={user.role}
                        onChange={(e) => updateUser(user.id, "role", e.target.value)}
                        className="text-sm border rounded px-2 py-1"
                      >
                        {USER_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={user.global_role}
                        onChange={(e) => updateUser(user.id, "global_role", e.target.value)}
                        className="text-sm border rounded px-2 py-1"
                      >
                        {GLOBAL_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    {selectedDepartment && (
                      <td className="px-6 py-4">
                        {user.department_membership_id ? (
                          <select
                            value={user.department_role ?? "member"}
                            onChange={(event) => void updateDepartmentRole(user, event.target.value)}
                            className="text-sm border rounded px-2 py-1"
                          >
                            {DEPT_ROLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm text-gray-400">Not assigned</span>
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4">
                      <select
                        value={user.status}
                        onChange={(e) => updateUser(user.id, "status", e.target.value)}
                        className="text-sm border rounded px-2 py-1"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openEditUser(user)}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                        <Link href={`/admin/users/${user.id}/departments`} className="text-blue-600 text-sm hover:underline">
                          Departments
                        </Link>
                        <button
                          type="button"
                          onClick={() => void deleteUser(user)}
                          disabled={deletingId === user.id || user.id === currentUserId}
                          className="text-sm text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:text-gray-300"
                          title={user.id === currentUserId ? "You cannot delete your own signed-in user" : "Delete user"}
                        >
                          {deletingId === user.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={selectedDepartment ? 8 : 7} className="px-6 py-8 text-center text-sm text-gray-500">
                      No users match the current filters.
                    </td>
                  </tr>
                )}
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
                  ["View assigned tasks", true, true, true, true],
                  ["View all tasks in assigned dept", false, true, true, true],
                  ["Create own tickets", true, true, true, true],
                  ["Assign created tickets", false, true, true, true],
                  ["Update task status in dept", false, true, true, true],
                  ["Update any dept tasks", false, false, false, true],
                  ["Get dept summary", true, true, true, true],
                  ["Get all dept summaries", false, false, false, true],
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

function sortUsers(a: User, b: User) {
  return (a.display_name ?? a.phone_e164).localeCompare(b.display_name ?? b.phone_e164);
}
