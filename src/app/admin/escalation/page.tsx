"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type OnCallHour = { id?: string; day_of_week: number; start_time: string; end_time: string };

type SupportMember = {
  id: string;
  created_at: string;
  department_id: string | null;
  department: { name: string } | null;
  user: { id: string; display_name: string | null; email: string | null; phone_e164: string } | null;
  hours: OnCallHour[];
};

type UserOption = { id: string; display_name: string | null; phone_e164: string; email: string | null };
type Department = { id: string; name: string };

export default function EscalationSupportPage() {
  const router = useRouter();
  const [members, setMembers] = useState<SupportMember[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [drafts, setDrafts] = useState<Record<string, OnCallHour[]>>({});
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const userRaw = localStorage.getItem("admin_user");
    const user = userRaw ? JSON.parse(userRaw) as { role?: string; global_role?: string } : null;
    if (!isAdminOrLeadership(user)) {
      router.push("/admin/conversations");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function apiFetch(path: string, init?: RequestInit) {
    return fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey, ...(init?.headers ?? {}) },
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [membersRes, usersRes, deptRes] = await Promise.all([
        apiFetch("/api/admin/escalation-support"),
        apiFetch("/api/admin/users"),
        apiFetch("/api/departments"),
      ]);
      const membersData = await membersRes.json().catch(() => ({}));
      if (!membersRes.ok) throw new Error(membersData.error ?? "Failed to load support team");
      const list = (membersData.members ?? []) as SupportMember[];
      setMembers(list);
      // Postgres returns time as "HH:MM:SS"; the time picker needs "HH:MM".
      setDrafts(Object.fromEntries(list.map((m) => [
        m.id,
        sortHours((m.hours ?? []).map((h) => ({ ...h, start_time: h.start_time.slice(0, 5), end_time: h.end_time.slice(0, 5) }))),
      ])));
      if (usersRes.ok) setUsers((await usersRes.json()) as UserOption[]);
      if (deptRes.ok) setDepartments((await deptRes.json()) as Department[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load support team");
    } finally {
      setLoading(false);
    }
  }

  async function addMember() {
    if (!selectedUserId || !selectedDeptId) return;
    setAdding(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/escalation-support", {
        method: "POST",
        body: JSON.stringify({ user_id: selectedUserId, department_id: selectedDeptId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add member");
      setSelectedUserId("");
      setSelectedDeptId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(member: SupportMember) {
    const label = member.user?.display_name || member.user?.email || member.user?.phone_e164 || "this member";
    if (!window.confirm(`Remove ${label} from the support team? Their on-call hours will be deleted.`)) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/escalation-support/${member.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to remove member");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  async function saveHours(memberId: string) {
    setSavingId(memberId);
    setError(null);
    try {
      const hours = (drafts[memberId] ?? []).map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time }));
      const res = await apiFetch(`/api/admin/escalation-support/${memberId}`, {
        method: "PUT",
        body: JSON.stringify({ hours }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save hours");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save hours");
    } finally {
      setSavingId(null);
    }
  }

  function setDraft(memberId: string, hours: OnCallHour[]) {
    setDrafts((prev) => ({ ...prev, [memberId]: hours }));
  }

  function addRange(memberId: string) {
    setDraft(memberId, [...(drafts[memberId] ?? []), { day_of_week: 1, start_time: "09:00", end_time: "17:00" }]);
  }

  function updateRange(memberId: string, index: number, patch: Partial<OnCallHour>) {
    setDraft(memberId, (drafts[memberId] ?? []).map((h, i) => (i === index ? { ...h, ...patch } : h)));
  }

  function removeRange(memberId: string, index: number) {
    setDraft(memberId, (drafts[memberId] ?? []).filter((_, i) => i !== index));
  }

  // Only users with an email can be added — escalations are delivered by email. A user can
  // be an escalation member for multiple departments, so don't exclude existing members.
  const addableUsers = users.filter((u) => Boolean(u.email && u.email.trim()));
  const sortedMembers = [...members].sort((a, b) =>
    (a.department?.name ?? "~").localeCompare(b.department?.name ?? "~"),
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold">Escalation/Support</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Escalation members are alerted <strong>per department</strong> while on call (America/Chicago): when a chat or issue is escalated, the agent routes it to its department and only that department&apos;s on-call members are notified. Membership grants Lead Inbox access.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">Add Escalation Member</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm text-gray-700 dark:text-gray-300">
            Existing User
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">Select user...</option>
              {addableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name || user.phone_e164}{user.email ? ` (${user.email})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-sm text-gray-700 dark:text-gray-300">
            Department <span className="text-red-500">*</span>
            <select
              value={selectedDeptId}
              onChange={(event) => setSelectedDeptId(event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">Select department...</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void addMember()}
            disabled={!selectedUserId || !selectedDeptId || adding}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            {adding ? "Adding..." : "Add"}
          </button>
        </div>
        <span className="mt-2 block text-xs text-gray-500 dark:text-gray-400">
          Only users with an email are listed — escalations are delivered by email. Add the same user to multiple departments if they cover more than one.
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No escalation members yet. Add one above.</p>
      ) : (
        <div className="space-y-4">
          {sortedMembers.map((member) => {
            const hours = drafts[member.id] ?? [];
            return (
              <div key={member.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{member.user?.display_name || member.user?.phone_e164 || "Unknown user"}</p>
                      <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        {member.department?.name ?? "All departments (fallback)"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {member.user?.phone_e164}{member.user?.email ? ` · ${member.user.email}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeMember(member)}
                    className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-sm font-medium">On-call hours (America/Chicago)</p>
                  {hours.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Not on call — no hours set.</p>
                  ) : (
                    <div className="space-y-2">
                      {hours.map((range, index) => (
                        <div key={index} className="flex flex-wrap items-center gap-2">
                          <select
                            value={range.day_of_week}
                            onChange={(event) => updateRange(member.id, index, { day_of_week: Number(event.target.value) })}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                          >
                            {DAY_NAMES.map((name, dayIndex) => (
                              <option key={dayIndex} value={dayIndex}>{name}</option>
                            ))}
                          </select>
                          <input
                            type="time"
                            value={range.start_time}
                            onChange={(event) => updateRange(member.id, index, { start_time: event.target.value })}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                          />
                          <span className="text-sm text-gray-500 dark:text-gray-400">to</span>
                          <input
                            type="time"
                            value={range.end_time}
                            onChange={(event) => updateRange(member.id, index, { end_time: event.target.value })}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                          />
                          <button
                            type="button"
                            onClick={() => removeRange(member.id, index)}
                            className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => addRange(member.id)}
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                    >
                      + Add range
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveHours(member.id)}
                      disabled={savingId === member.id}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingId === member.id ? "Saving..." : "Save hours"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function sortHours(hours: OnCallHour[]): OnCallHour[] {
  return [...hours].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
}
