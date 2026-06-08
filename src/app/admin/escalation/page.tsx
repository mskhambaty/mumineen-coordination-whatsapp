"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

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

type Tally = { label: string; count: number };
type RecentReason = { reason: string; category: string; priority: string; escalated_at: string | null };
type Breakdown = { total: number; pending: number; by_category: Tally[]; by_priority: Tally[]; recent: RecentReason[] };

export default function EscalationSupportPage() {
  const router = useRouter();
  const [members, setMembers] = useState<SupportMember[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [drafts, setDrafts] = useState<Record<string, OnCallHour[]>>({});
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [filterDeptId, setFilterDeptId] = useState("all");
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const [expandedHours, setExpandedHours] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    if (!canAccessPortal(user)) {
      router.push("/admin/conversations");
      return;
    }
    void load();

  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [membersRes, usersRes, deptRes, breakdownRes] = await Promise.all([
        apiFetch("/api/admin/escalation-support"),
        apiFetch("/api/admin/users"),
        apiFetch("/api/departments"),
        apiFetch("/api/admin/escalations/breakdown"),
      ]);
      if (breakdownRes.ok) setBreakdown((await breakdownRes.json()) as Breakdown);
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
      // "general" = no specific department (all-departments fallback).
      const departmentId = selectedDeptId === "general" ? null : selectedDeptId;
      const res = await apiFetch("/api/admin/escalation-support", {
        method: "POST",
        body: JSON.stringify({ user_id: selectedUserId, department_id: departmentId }),
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

  function toggleHours(id: string) {
    setExpandedHours((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function changeDepartment(member: SupportMember, value: string) {
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/escalation-support/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ department_id: value === "general" ? null : value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to change department");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change department");
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
  const visibleMembers = sortedMembers.filter((m) => {
    if (filterDeptId === "all") return true;
    if (filterDeptId === "general") return !m.department_id;
    return m.department_id === filterDeptId;
  });
  // Departments that actually have at least one escalation member, for the filter dropdown.
  const departmentsWithMembers = departments.filter((d) => members.some((m) => m.department_id === d.id));

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold">Escalation &amp; On-call</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Escalation members are alerted <strong>per department</strong> while on call (America/Chicago): when a chat or issue is escalated, the agent routes it to its department and only that department&apos;s on-call members are notified. Membership grants Lead Inbox access.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {breakdown && breakdown.total > 0 && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Why chats get escalated</h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">{breakdown.total} total · {breakdown.pending} pending</span>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Patterns in what the bot hands off — high-volume categories often signal where an FAQ or process fix would help.
          </p>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">By category</h3>
              <div className="space-y-1.5">
                {breakdown.by_category.map((c) => {
                  const pct = breakdown.total ? Math.round((c.count / breakdown.total) * 100) : 0;
                  return (
                    <div key={c.label} className="flex items-center gap-2 text-sm">
                      <span className="w-28 shrink-0 capitalize text-gray-600 dark:text-gray-300">{c.label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <span className="block h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-14 shrink-0 text-right tabular-nums text-gray-500 dark:text-gray-400">{c.count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">By priority</h3>
              <div className="space-y-1.5">
                {breakdown.by_priority.map((p) => (
                  <div key={p.label} className="flex items-center gap-2 text-sm">
                    <span className={`w-28 shrink-0 capitalize ${p.label === "urgent" ? "font-medium text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-300"}`}>{p.label}</span>
                    <span className="text-gray-500 dark:text-gray-400 tabular-nums">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {breakdown.recent.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
              <button type="button" onClick={() => setShowReasons((v) => !v)} className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400">
                {showReasons ? "Hide" : "Show"} recent reasons ({breakdown.recent.length})
              </button>
              {showReasons && (
                <ul className="mt-2 space-y-2">
                  {breakdown.recent.map((r, i) => (
                    <li key={i} className="text-sm">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs capitalize text-gray-600 dark:bg-gray-800 dark:text-gray-300">{r.category}</span>
                      {r.priority === "urgent" && <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">urgent</span>}
                      <span className="ml-2 text-gray-700 dark:text-gray-300">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
              <option value="general">General — all departments (fallback)</option>
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

      {!loading && members.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">Show</label>
          <select
            value={filterDeptId}
            onChange={(event) => setFilterDeptId(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">All members ({members.length})</option>
            <option value="general">General — all departments (fallback)</option>
            {departmentsWithMembers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No escalation members yet. Add one above.</p>
      ) : visibleMembers.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No escalation members in this filter.</p>
      ) : (
        <div className="space-y-4">
          {visibleMembers.map((member) => {
            const hours = drafts[member.id] ?? [];
            return (
              <div key={member.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{member.user?.display_name || member.user?.phone_e164 || "Unknown user"}</p>
                      <select
                        value={member.department_id ?? "general"}
                        onChange={(event) => void changeDepartment(member, event.target.value)}
                        title="Change which department this member covers"
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="general">General — all departments (fallback)</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
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
                  <button
                    type="button"
                    onClick={() => toggleHours(member.id)}
                    className="flex w-full items-center justify-between text-left text-sm font-medium"
                  >
                    <span>
                      On-call hours (America/Chicago)
                      <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                        {hours.length === 0 ? "· not on call" : `· ${hours.length} range${hours.length !== 1 ? "s" : ""}`}
                      </span>
                    </span>
                    <span className="text-gray-400">{expandedHours.has(member.id) ? "▲" : "▼"}</span>
                  </button>
                </div>
                {expandedHours.has(member.id) && (
                <div className="mt-3">
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
                )}
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
