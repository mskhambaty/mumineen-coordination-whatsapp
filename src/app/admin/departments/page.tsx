"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Department = {
  id: string;
  name: string;
  description: string | null;
};

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
  contact_for_issues?: boolean;
};

type DepartmentMembership = {
  id: string;
  department_id: string;
  dept_role: string;
  is_active: boolean;
  contact_for_issues: boolean;
};

const DEPT_ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "pm", label: "PM" },
  { value: "hod", label: "HOD" },
];

export default function DepartmentsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [departmentUsers, setDepartmentUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [newDepartmentDescription, setNewDepartmentDescription] = useState("");
  const [newMemberUserId, setNewMemberUserId] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("member");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId) ?? null;
  const memberIds = useMemo(() => new Set(departmentUsers.map((user) => user.id)), [departmentUsers]);
  const addableUsers = allUsers.filter((user) => !memberIds.has(user.id));
  const filteredDepartmentUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return departmentUsers;
    return departmentUsers.filter((user) =>
      [user.display_name, user.phone_e164, user.email, user.department_role, user.status].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    );
  }, [departmentUsers, searchQuery]);

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

    // eslint-disable-next-line react-hooks/immutability
    void loadInitialData();

  }, [router]);

  useEffect(() => {
    if (!selectedDepartmentId) return;
    // eslint-disable-next-line react-hooks/immutability
    void loadDepartmentUsers(selectedDepartmentId);

  }, [selectedDepartmentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDescriptionDraft(selectedDepartment?.description ?? "");
  }, [selectedDepartment]);

  async function loadInitialData() {
    setLoading(true);
    setError(null);
    try {
      const [departmentsRes, usersRes] = await Promise.all([
        apiFetch("/api/departments"),
        apiFetch("/api/admin/users"),
      ]);
      const departmentsData = await departmentsRes.json().catch(() => []);
      const usersData = await usersRes.json().catch(() => []);
      if (!departmentsRes.ok) throw new Error(departmentsData.error ?? "Failed to load departments");
      if (!usersRes.ok) throw new Error(usersData.error ?? "Failed to load users");

      const nextDepartments = departmentsData as Department[];
      setDepartments(nextDepartments);
      setAllUsers(usersData as User[]);
      setSelectedDepartmentId((current) => current ?? nextDepartments[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load departments");
    } finally {
      setLoading(false);
    }
  }

  async function loadDepartmentUsers(departmentId: string) {
    setError(null);
    const res = await apiFetch(`/api/admin/users?department_id=${encodeURIComponent(departmentId)}`);
    const data = await res.json().catch(() => []);
    if (!res.ok) {
      setError(data.error ?? "Failed to load department users");
      return;
    }
    setDepartmentUsers(data as User[]);
  }

  async function createDepartment(event: React.FormEvent) {
    event.preventDefault();
    if (!newDepartmentName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/departments", {
        method: "POST",
        body: JSON.stringify({
          name: newDepartmentName,
          description: newDepartmentDescription,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create department");
      const created = data as Department;
      setDepartments((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedDepartmentId(created.id);
      setNewDepartmentName("");
      setNewDepartmentDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create department");
    } finally {
      setSaving(false);
    }
  }

  async function removeDepartment(department: Department) {
    if (!window.confirm(`Remove ${department.name}? Departments with members, tasks, or milestones cannot be removed.`)) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/departments/${department.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to remove department");
      const remaining = departments.filter((item) => item.id !== department.id);
      setDepartments(remaining);
      setSelectedDepartmentId(remaining[0]?.id ?? null);
      setDepartmentUsers([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove department");
    } finally {
      setSaving(false);
    }
  }

  async function saveDescription() {
    if (!selectedDepartment) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/departments/${selectedDepartment.id}`, {
        method: "PUT",
        body: JSON.stringify({ description: descriptionDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save description");
      setDepartments((items) =>
        items.map((item) => item.id === selectedDepartment.id ? { ...item, description: data.description ?? null } : item),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save description");
    } finally {
      setSaving(false);
    }
  }

  async function addExistingUser(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedDepartment || !newMemberUserId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/users/${newMemberUserId}/departments`, {
        method: "POST",
        body: JSON.stringify({ department_id: selectedDepartment.id, dept_role: newMemberRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add member");
      const membership = data as DepartmentMembership;
      const user = allUsers.find((item) => item.id === newMemberUserId);
      if (user) {
        setDepartmentUsers((items) =>
          [...items, {
            ...user,
            department_membership_id: membership.id,
            department_role: membership.dept_role,
            contact_for_issues: membership.contact_for_issues,
          }].sort(sortUsers),
        );
      }
      setNewMemberUserId("");
      setNewMemberRole("member");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setSaving(false);
    }
  }

  async function updateMembership(user: User, updates: Record<string, unknown>) {
    if (!user.department_membership_id) return;
    setError(null);
    const res = await apiFetch(`/api/admin/users/${user.id}/departments/${user.department_membership_id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to update department member");
      return;
    }
    if (updates.is_active === false) {
      setDepartmentUsers((items) => items.filter((item) => item.id !== user.id));
      return;
    }
    setDepartmentUsers((items) =>
      items.map((item) =>
        item.id === user.id
          ? {
              ...item,
              department_role: typeof updates.dept_role === "string" ? updates.dept_role : item.department_role,
              contact_for_issues: typeof updates.contact_for_issues === "boolean" ? updates.contact_for_issues : item.contact_for_issues,
            }
          : item,
      ),
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-gray-500 dark:text-gray-400">Loading...</p></div>;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Departments</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage department rosters and issue notification contacts.</p>
        </div>
        <form onSubmit={createDepartment} className="grid gap-2 md:grid-cols-[190px_minmax(220px,1fr)_auto] md:items-end">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Name
            <input
              value={newDepartmentName}
              onChange={(event) => setNewDepartmentName(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              placeholder="New department"
            />
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Description
            <input
              value={newDepartmentDescription}
              onChange={(event) => setNewDepartmentDescription(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              placeholder="What this department handles"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !newDepartmentName.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Add
          </button>
        </form>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {departments.map((department) => (
          <button
            key={department.id}
            type="button"
            onClick={() => setSelectedDepartmentId(department.id)}
            className={`rounded-lg border p-4 text-left shadow-sm ${
              selectedDepartmentId === department.id
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
                : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
            }`}
          >
            <span className="block font-semibold text-gray-900 dark:text-gray-100">{department.name}</span>
            <span className="mt-2 line-clamp-3 block text-xs text-gray-500 dark:text-gray-400">
              {department.description || "No description yet."}
            </span>
          </button>
        ))}
      </div>

      {selectedDepartment && (
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b px-5 py-4 dark:border-gray-800">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{selectedDepartment.name}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{departmentUsers.length} active member{departmentUsers.length === 1 ? "" : "s"}</p>
              </div>
              <button
                type="button"
                onClick={() => void removeDepartment(selectedDepartment)}
                disabled={saving}
                className="self-start rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                Remove Department
              </button>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Department Description
                <textarea
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
              <button
                type="button"
                onClick={() => void saveDescription()}
                disabled={saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>

          <div className="border-b px-5 py-4 dark:border-gray-800">
            <form onSubmit={addExistingUser} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_auto] md:items-end">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Add Existing User
                <select
                  value={newMemberUserId}
                  onChange={(event) => setNewMemberUserId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Select user...</option>
                  {addableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name || user.phone_e164}{user.email ? ` (${user.email})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Role
                <select
                  value={newMemberRole}
                  onChange={(event) => setNewMemberRole(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  {DEPT_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={saving || !newMemberUserId}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Add User
              </button>
            </form>
          </div>

          <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between dark:border-gray-800">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Department Users</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Issue contacts receive email and WhatsApp template notifications for department tickets.</p>
            </div>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search users..."
              className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800/60">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Name</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Phone</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Email</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Role</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Contact for Issues</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {filteredDepartmentUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-5 py-4 font-medium">{user.display_name ?? "—"}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{user.phone_e164}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{user.email ?? "—"}</td>
                    <td className="px-5 py-4">
                      <select
                        value={user.department_role ?? "member"}
                        onChange={(event) => void updateMembership(user, { dept_role: event.target.value })}
                        className="rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      >
                        {DEPT_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={user.contact_for_issues === true}
                          onChange={(event) => void updateMembership(user, { contact_for_issues: event.target.checked })}
                        />
                        Notify
                      </label>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => void updateMembership(user, { is_active: false })}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredDepartmentUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                      No users in this department.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function sortUsers(a: User, b: User) {
  return (a.display_name ?? a.phone_e164).localeCompare(b.display_name ?? b.phone_e164);
}
