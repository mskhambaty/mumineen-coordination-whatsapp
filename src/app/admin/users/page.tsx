"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type User = {
  id: string;
  display_name: string | null;
  phone_e164: string;
  email: string | null;
  role: string;
  global_role: string;
  status: string;
  is_master_admin?: boolean | null;
  last_login_at?: string | null;
  department_membership_id?: string | null;
  department_role?: string | null;
};

type Department = {
  id: string;
  name: string;
  description: string | null;
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

function formatLastLogin(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ display_name: "", phone_e164: "", email: "", role: "committee", global_role: "member" });
  const [newUserDeptId, setNewUserDeptId] = useState("");
  const [newUserDeptRole, setNewUserDeptRole] = useState("member");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UserForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [welcomeId, setWelcomeId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
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
  const [currentUserIsMasterAdmin] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const userRaw = window.localStorage.getItem("admin_user");
    if (!userRaw) return false;
    try {
      const user = JSON.parse(userRaw) as { is_master_admin?: boolean };
      return user.is_master_admin === true;
    } catch {
      return false;
    }
  });
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
    if (!openMenuId) return;
    function handleDismiss(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        event.target instanceof Element &&
        event.target.closest("[data-user-actions]")
      ) {
        return;
      }
      setOpenMenuId(null);
    }
    document.addEventListener("mousedown", handleDismiss);
    document.addEventListener("keydown", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleDismiss);
      document.removeEventListener("keydown", handleDismiss);
    };
  }, [openMenuId]);

  useEffect(() => {
    const currentUser = readAdminUser();
    if (!currentUser) {
      router.push("/admin/login");
      return;
    }
    if (!isAdminOrLeadership(currentUser)) {
      router.push("/admin/conversations");
      return;
    }

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (selectedDepartmentId !== "all") params.set("department_id", selectedDepartmentId);

        const [usersRes, departmentsRes] = await Promise.all([
          apiFetch(`/api/admin/users?${params.toString()}`),
          apiFetch("/api/departments"),
        ]);

        if (!usersRes.ok) {
          const data = await usersRes.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Failed to fetch users");
        }
        const fetchedUsers = await usersRes.json() as User[];
        setUsers(fetchedUsers);

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
  }, [router, selectedDepartmentId]);

  async function updateUser(id: string, field: string, value: string) {
    try {
      const res = await apiFetch(`/api/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to update user");
      }
      const updated = await res.json() as User;
      setUsers((items) => items.map((user) => user.id === id ? { ...user, ...updated } : user));
    } catch (err) {
      console.error("Failed to update user:", err);
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to add user");
      }
      const created = await res.json() as User;
      let membership: DepartmentMembership | null = null;

      if (newUserDeptId) {
        membership = await addMembership(created.id, newUserDeptId, newUserDeptRole, true);
      }

      setShowAddUser(false);
      setNewUser({ display_name: "", phone_e164: "", email: "", role: "committee", global_role: "member" });
      setNewUserDeptId("");
      setNewUserDeptRole("member");

      // Add to the current filtered list only if it belongs in this view.
      const matchesView = selectedDepartmentId === "all" || (membership !== null && newUserDeptId === selectedDepartmentId);
      if (matchesView) {
        const forList = membership && newUserDeptId === selectedDepartmentId
          ? { ...created, department_membership_id: membership.id, department_role: membership.dept_role }
          : created;
        setUsers((items) => [...items, forList].sort(sortUsers));
      }
    } catch (err) {
      console.error("Failed to add user:", err);
      setError(err instanceof Error ? err.message : "Failed to add user");
    }
  }

  async function addMembership(
    userId: string,
    departmentId: string,
    deptRole: string,
    sendWelcome = false,
  ): Promise<DepartmentMembership> {
    const res = await apiFetch(`/api/admin/users/${userId}/departments`, {
      method: "POST",
      body: JSON.stringify({ department_id: departmentId, dept_role: deptRole, send_welcome: sendWelcome }),
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
    setNewPassword("");
    setShowNewPassword(false);
    setPasswordMsg(null);
  }

  function closeEditUser() {
    setEditingUser(null);
    setEditForm(null);
    setNewPassword("");
    setShowNewPassword(false);
    setPasswordMsg(null);
  }

  async function setUserPassword() {
    if (!editingUser) return;
    if (newPassword.length < 8) {
      setPasswordMsg({ type: "err", text: "Password must be at least 8 characters." });
      return;
    }
    setSettingPassword(true);
    setPasswordMsg(null);
    try {
      const res = await apiFetch(`/api/admin/users/${editingUser.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to set password");
      setNewPassword("");
      setShowNewPassword(false);
      setPasswordMsg({ type: "ok", text: "Password updated." });
    } catch (err) {
      setPasswordMsg({ type: "err", text: err instanceof Error ? err.message : "Failed to set password" });
    } finally {
      setSettingPassword(false);
    }
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !editForm) return;

    setSavingEdit(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/users/${editingUser.id}`, {
        method: "PUT",
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
      closeEditUser();
    } catch (err) {
      console.error("Failed to save user:", err);
      setError(err instanceof Error ? err.message : "Failed to save user");
    } finally {
      setSavingEdit(false);
    }
  }

  async function sendWelcome(user: User) {
    const label = user.display_name || user.email || user.phone_e164;
    if (!user.email) {
      if (!window.confirm(`${label} has no email on file — the welcome can only go out over WhatsApp. Continue?`)) {
        return;
      }
    } else if (!window.confirm(`Send a welcome + password-reset link to ${label} (${user.email})?`)) {
      return;
    }

    setWelcomeId(user.id);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/admin/users/${user.id}/welcome`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string;
        welcome_notification?: { email: string; whatsapp: string; errors: string[] };
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to send welcome");

      const wn = data.welcome_notification;
      if (wn?.errors?.length) {
        setError(`Welcome to ${label} had issues — email: ${wn.email}, WhatsApp: ${wn.whatsapp}. ${wn.errors.join("; ")}`);
      } else {
        setNotice(`Welcome sent to ${label} — email: ${wn?.email ?? "skipped"}, WhatsApp: ${wn?.whatsapp ?? "skipped"}.`);
      }
    } catch (err) {
      console.error("Failed to send welcome:", err);
      setError(err instanceof Error ? err.message : "Failed to send welcome");
    } finally {
      setWelcomeId(null);
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
      const res = await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to delete user");
      }
      setUsers((items) => items.filter((item) => item.id !== user.id));
    } catch (err) {
      console.error("Failed to delete user:", err);
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-gray-500 dark:text-gray-400">Loading...</p></div>;
  }

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 flex justify-end">
        <button
          onClick={() => {
            setNewUserDeptId(selectedDepartmentId !== "all" ? selectedDepartmentId : "");
            setShowAddUser(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          Add User
        </button>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
            {notice}
          </div>
        )}

        {/* Add User Modal */}
        {showAddUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Add User</h3>
              <form onSubmit={addUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Display Name *</label>
                  <input type="text" required value={newUser.display_name} onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone (E.164) *</label>
                  <input type="text" required value={newUser.phone_e164} onChange={(e) => setNewUser({ ...newUser, phone_e164: e.target.value })} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md" placeholder="+1234567890" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
                  <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Account Role</label>
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
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md"
                  >
                    {USER_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Department</label>
                    <select value={newUserDeptId} onChange={(e) => setNewUserDeptId(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md">
                      <option value="">No department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Department Role</label>
                    <select value={newUserDeptRole} onChange={(e) => setNewUserDeptRole(e.target.value)} disabled={!newUserDeptId} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md disabled:opacity-50">
                      {DEPT_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Assign a department now so it isn&apos;t missed. You can add more departments later from the user&apos;s Departments page.</p>
                <div className="flex justify-end space-x-3">
                  <button type="button" onClick={() => setShowAddUser(false)} className="px-4 py-2 text-gray-600 dark:text-gray-300">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Add</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {editingUser && editForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-lg">
              <h3 className="text-lg font-semibold mb-4">Edit User</h3>
              <form onSubmit={saveUser} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Display Name
                    <input
                      type="text"
                      value={editForm.display_name}
                      onChange={(event) => setEditForm({ ...editForm, display_name: event.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md"
                    />
                  </label>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Phone (E.164)
                    <input
                      type="text"
                      required
                      value={editForm.phone_e164}
                      onChange={(event) => setEditForm({ ...editForm, phone_e164: event.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md"
                    />
                  </label>
                </div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Email
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md"
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md"
                    >
                      {USER_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Status
                    <select
                      value={editForm.status}
                      onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md"
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
                    onClick={closeEditUser}
                    className="px-4 py-2 text-gray-600 dark:text-gray-300"
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

              {currentUserIsMasterAdmin && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/20">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingUser.is_master_admin)}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        if (next && !window.confirm(`Grant master admin to ${editingUser.display_name ?? editingUser.email}? They will have unrestricted access to all portal features.`)) return;
                        if (!next && !window.confirm(`Remove master admin from ${editingUser.display_name ?? editingUser.email}?`)) return;
                        try {
                          const res = await apiFetch(`/api/admin/users/${editingUser.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ is_master_admin: next }),
                          });
                          if (!res.ok) {
                            const d = await res.json().catch(() => ({})) as { error?: string };
                            throw new Error(d.error ?? "Failed to update");
                          }
                          const updated = await res.json() as User;
                          setUsers((items) => items.map((u) => u.id === updated.id ? { ...u, ...updated } : u));
                          setEditingUser((prev) => prev ? { ...prev, is_master_admin: updated.is_master_admin } : prev);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to update master admin");
                        }
                      }}
                      className="h-4 w-4 accent-amber-600"
                    />
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-300">Master Admin</span>
                    <span className="text-xs text-amber-600 dark:text-amber-400">— unrestricted access + export + registration edit</span>
                  </label>
                </div>
              )}

              {/* Set / change portal password — separate from the profile form above. */}
              <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Set Password</h4>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Set or override this user&apos;s portal password directly. They can sign in with it immediately. Minimum 8 characters.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="relative flex-1">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(event) => { setNewPassword(event.target.value); if (passwordMsg) setPasswordMsg(null); }}
                      placeholder="New password"
                      autoComplete="new-password"
                      className="block w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 pr-16 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                      className="absolute inset-y-0 right-2 my-auto h-6 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      {showNewPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void setUserPassword()}
                    disabled={settingPassword || newPassword.length < 8}
                    className="shrink-0 rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
                  >
                    {settingPassword ? "Setting..." : "Set Password"}
                  </button>
                </div>
                {passwordMsg && (
                  <p className={`mt-2 text-xs ${passwordMsg.type === "ok" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {passwordMsg.text}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden mb-8">
          <div className="flex flex-col gap-3 border-b px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Users</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{filteredUsers.length} of {users.length} users shown</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300 md:min-w-72">
                Search
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Name, phone, email, role..."
                  className="rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300 md:min-w-72">
                Department
                <select
                  value={selectedDepartmentId}
                  onChange={(event) => setSelectedDepartmentId(event.target.value)}
                  className="rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm"
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
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800/60">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Display Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Account Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last Login</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-6 py-4 font-medium">
                      {user.display_name ?? "—"}
                      {user.is_master_admin && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">Master Admin</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{user.phone_e164}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{user.email ?? "—"}</td>
                    <td className="px-6 py-4">
                      <select
                        value={user.role}
                        onChange={(e) => updateUser(user.id, "role", e.target.value)}
                        className="text-sm border border-gray-200 rounded px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      >
                        {USER_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={user.status}
                        onChange={(e) => updateUser(user.id, "status", e.target.value)}
                        className="text-sm border border-gray-200 rounded px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      <span className={user.last_login_at ? "" : "text-gray-400 dark:text-gray-500"}>
                        {formatLastLogin(user.last_login_at)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="relative inline-block text-left" data-user-actions>
                        <button
                          type="button"
                          onClick={() => setOpenMenuId((current) => (current === user.id ? null : user.id))}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                          aria-haspopup="true"
                          aria-expanded={openMenuId === user.id}
                        >
                          Actions
                          <span aria-hidden className="text-xs">▾</span>
                        </button>
                        {openMenuId === user.id && (
                          <div className="absolute right-0 z-10 mt-1 w-44 origin-top-right rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                            <button
                              type="button"
                              onClick={() => { setOpenMenuId(null); openEditUser(user); }}
                              className="block w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                              Edit
                            </button>
                            <Link
                              href={`/admin/users/${user.id}/departments`}
                              onClick={() => setOpenMenuId(null)}
                              className="block w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                              Departments
                            </Link>
                            <button
                              type="button"
                              onClick={() => { setOpenMenuId(null); void sendWelcome(user); }}
                              disabled={welcomeId === user.id}
                              className="block w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-300"
                            >
                              {welcomeId === user.id ? "Sending welcome..." : "Send welcome"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setOpenMenuId(null); void deleteUser(user); }}
                              disabled={deletingId === user.id || user.id === currentUserId}
                              className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-300"
                              title={user.id === currentUserId ? "You cannot delete your own signed-in user" : "Delete user"}
                            >
                              {deletingId === user.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                      No users match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Permission Matrix */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Permission Matrix</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800/60">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Member</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">PM</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">HOD</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Leadership / Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
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
                    <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">{action as string}</td>
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
    </>
  );
}

function sortUsers(a: User, b: User) {
  return (a.display_name ?? a.phone_e164).localeCompare(b.display_name ?? b.phone_e164);
}
