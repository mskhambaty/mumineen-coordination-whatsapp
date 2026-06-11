"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type Member = {
  id: string;
  user: {
    id: string;
    display_name: string | null;
    email: string | null;
    phone_e164: string | null;
  } | null;
};

type Department = { id: string; name: string };

// A contact is either a freestanding reference row or a portal user flagged as a department
// issue contact (member). The list and the API mix both; `kind` discriminates them.
type Contact = {
  kind: "reference" | "member";
  id: string;
  membership_id?: string;
  user_id?: string;
  dept_role?: string;
  department_id: string;
  department: { name: string } | null;
  name: string | null;
  role: string | null;
  phone_e164: string | null;
  email: string | null;
  notes: string | null;
};

type ContactSource = "existing_user" | "new_contact";

type ContactDraft = {
  department_id: string;
  source: ContactSource;
  user_id: string;     // existing_user
  dept_role: string;   // existing_user / also-create-as-user
  also_user: boolean;  // new_contact → also provision a department user
  name: string;
  role: string;
  phone_e164: string;
  email: string;
  notes: string;
};

const EMPTY_DRAFT: ContactDraft = {
  department_id: "",
  source: "existing_user",
  user_id: "",
  dept_role: "member",
  also_user: false,
  name: "",
  role: "",
  phone_e164: "",
  email: "",
  notes: "",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EscalationPage() {
  const router = useRouter();

  // Escalation team
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<{ id: string; display_name: string | null; email: string | null; phone_e164: string | null }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Department contacts
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft>(EMPTY_DRAFT);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editDraft, setEditDraft] = useState<ContactDraft>(EMPTY_DRAFT);
  const [savingContact, setSavingContact] = useState(false);
  const [removingContactId, setRemovingContactId] = useState<string | null>(null);
  // Members of the department selected in the add-contact form (for the "existing user" picker).
  const [deptUsers, setDeptUsers] = useState<{ id: string; display_name: string | null; email: string | null; phone_e164: string | null; contact_for_issues: boolean }[]>([]);
  const [deptUsersLoading, setDeptUsersLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [membersRes, usersRes, contactsRes, deptsRes] = await Promise.all([
        apiFetch("/api/admin/escalation-support"),
        apiFetch("/api/admin/users"),
        apiFetch("/api/admin/department-contacts"),
        apiFetch("/api/departments"),
      ]);
      if (membersRes.ok) {
        const d = await membersRes.json() as { members: Member[] };
        setMembers(d.members ?? []);
      }
      if (usersRes.ok) {
        const u = await usersRes.json() as { id: string; display_name: string | null; email: string | null; phone_e164: string | null }[];
        setUsers(u);
      }
      if (contactsRes.ok) {
        const c = await contactsRes.json() as { contacts: Contact[] };
        setContacts(c.contacts ?? []);
      }
      if (deptsRes.ok) {
        setDepartments(await deptsRes.json() as Department[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const user = readAdminUser();
    if (!user || !canAccessPortal(user)) {
      router.push("/admin/login");
      return;
    }
    void loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ─── Escalation team ──────────────────────────────────────────────────────

  const existingUserIds = new Set(members.map((m) => m.user?.id).filter(Boolean));
  const eligibleUsers = users.filter((u) => !existingUserIds.has(u.id) && (u.email || u.phone_e164));

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUserId) return;
    setAddingMember(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/escalation-support", {
        method: "POST",
        body: JSON.stringify({ user_id: selectedUserId }),
      });
      const data = await res.json() as { member?: Member; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add member");
      setMembers((prev) => [...prev, data.member!]);
      setSelectedUserId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  }

  async function removeMember(member: Member) {
    const label = member.user?.display_name ?? member.user?.email ?? "this user";
    if (!window.confirm(`Remove ${label} from the escalation team?`)) return;
    setRemovingId(member.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/escalation-support/${member.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to remove member");
      }
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingId(null);
    }
  }

  // ─── Department contacts ──────────────────────────────────────────────────

  // Load the selected department's members for the "existing user" picker. We only ever flag an
  // existing member as a contact here, so the picker must be scoped to that department.
  async function loadDeptUsers(departmentId: string) {
    if (!departmentId) {
      setDeptUsers([]);
      return;
    }
    setDeptUsersLoading(true);
    try {
      const res = await apiFetch(`/api/admin/users?department_id=${departmentId}`);
      setDeptUsers(res.ok ? await res.json() : []);
    } catch {
      setDeptUsers([]);
    } finally {
      setDeptUsersLoading(false);
    }
  }

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    if (!contactDraft.department_id) return;

    // Build the payload for the chosen source: pick an existing user, create a new user, or a
    // plain reference contact (the default when "New contact" is left without the user checkbox).
    let payload: Record<string, unknown>;
    if (contactDraft.source === "existing_user") {
      if (!contactDraft.user_id) return;
      payload = { mode: "existing_user", department_id: contactDraft.department_id, user_id: contactDraft.user_id };
    } else if (contactDraft.also_user) {
      if (!contactDraft.name.trim() || !contactDraft.phone_e164.trim()) return;
      payload = {
        mode: "new_user",
        department_id: contactDraft.department_id,
        name: contactDraft.name.trim(),
        phone_e164: contactDraft.phone_e164.trim(),
        email: contactDraft.email.trim() || null,
        dept_role: contactDraft.dept_role,
      };
    } else {
      if (!contactDraft.name.trim()) return;
      payload = {
        mode: "reference",
        department_id: contactDraft.department_id,
        name: contactDraft.name.trim(),
        role: contactDraft.role.trim() || null,
        phone_e164: contactDraft.phone_e164.trim() || null,
        email: contactDraft.email.trim() || null,
        notes: contactDraft.notes.trim() || null,
      };
    }

    setSavingContact(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/department-contacts", { method: "POST", body: JSON.stringify(payload) });
      const data = await res.json() as { contact?: Contact; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add contact");
      setContacts((prev) => [...prev, data.contact!]);
      setContactDraft(EMPTY_DRAFT);
      setShowAddContact(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setSavingContact(false);
    }
  }

  // Edit applies only to reference contacts (member contacts are managed on the Departments page).
  function openEditContact(contact: Contact) {
    setEditingContact(contact);
    setEditDraft({
      ...EMPTY_DRAFT,
      source: "new_contact",
      department_id: contact.department_id,
      name: contact.name ?? "",
      role: contact.role ?? "",
      phone_e164: contact.phone_e164 ?? "",
      email: contact.email ?? "",
      notes: contact.notes ?? "",
    });
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!editingContact) return;
    setSavingContact(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/department-contacts/${editingContact.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editDraft.name.trim(),
          role: editDraft.role.trim() || null,
          phone_e164: editDraft.phone_e164.trim() || null,
          email: editDraft.email.trim() || null,
          notes: editDraft.notes.trim() || null,
        }),
      });
      const data = await res.json() as { contact?: Contact; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save contact");
      setContacts((prev) => prev.map((c) => c.id === editingContact.id ? data.contact! : c));
      setEditingContact(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save contact");
    } finally {
      setSavingContact(false);
    }
  }

  async function removeContact(contact: Contact) {
    const label = contact.name ?? "this contact";
    const confirmMsg = contact.kind === "member"
      ? `Remove ${label} as an issue contact for this department? They stay a department user.`
      : `Remove ${label} from department contacts?`;
    if (!window.confirm(confirmMsg)) return;
    setRemovingContactId(contact.id);
    setError(null);
    try {
      // Member contacts: clear contact_for_issues (keep the user/membership). Reference: delete the row.
      const res = contact.kind === "member"
        ? await apiFetch(`/api/admin/users/${contact.user_id}/departments/${contact.membership_id}`, {
            method: "PUT",
            body: JSON.stringify({ contact_for_issues: false }),
          })
        : await apiFetch(`/api/admin/department-contacts/${contact.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to remove contact");
      }
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove contact");
    } finally {
      setRemovingContactId(null);
    }
  }

  const contactsByDept = contacts.reduce<Record<string, { deptName: string; contacts: Contact[] }>>((acc, c) => {
    const key = c.department_id;
    if (!acc[key]) acc[key] = { deptName: c.department?.name ?? "Unknown", contacts: [] };
    acc[key].contacts.push(c);
    return acc;
  }, {});

  // Users selectable in the "existing user" picker: members of the chosen department who aren't
  // already an issue contact.
  const pickableUsers = deptUsers.filter((u) => !u.contact_for_issues);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-gray-500 dark:text-gray-400">Loading…</p></div>;
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── Escalation Team ──────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Escalation Team</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Everyone on this list is notified via email and WhatsApp whenever a conversation is escalated.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800/60">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Phone</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
              {members.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                    No escalation team members yet.
                  </td>
                </tr>
              )}
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {member.user?.display_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {member.user?.email ?? <span className="text-gray-400 dark:text-gray-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {member.user?.phone_e164 ?? <span className="text-gray-400 dark:text-gray-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void removeMember(member)}
                      disabled={removingId === member.id}
                      className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-40"
                    >
                      {removingId === member.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {eligibleUsers.length > 0 && (
          <form onSubmit={addMember} className="mt-3 flex gap-2">
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm"
            >
              <option value="">Select a user to add…</option>
              {eligibleUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name ?? u.email ?? u.phone_e164}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!selectedUserId || addingMember}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {addingMember ? "Adding…" : "Add"}
            </button>
          </form>
        )}
      </section>

      {/* ── Department Contacts ───────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Department Contacts</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Reference list for the escalation team — who to reach out to per department.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowAddContact(true); setContactDraft(EMPTY_DRAFT); }}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add contact
          </button>
        </div>

        {showAddContact && (
          <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">New Contact</h3>
            <form onSubmit={addContact} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Department *</label>
                <select
                  required
                  value={contactDraft.department_id}
                  onChange={(e) => {
                    const department_id = e.target.value;
                    setContactDraft({ ...contactDraft, department_id, user_id: "" });
                    if (contactDraft.source === "existing_user") void loadDeptUsers(department_id);
                  }}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm"
                >
                  <option value="">Select department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Source: link an existing department member, or enter a new contact (optionally a new user). */}
              <div className="flex gap-2 text-sm">
                {([["existing_user", "Existing user"], ["new_contact", "New contact"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      setContactDraft({ ...contactDraft, source: val, user_id: "" });
                      if (val === "existing_user") void loadDeptUsers(contactDraft.department_id);
                    }}
                    className={`rounded-md px-3 py-1.5 ${contactDraft.source === val ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {contactDraft.source === "existing_user" ? (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Department member *</label>
                  <select
                    required
                    value={contactDraft.user_id}
                    disabled={!contactDraft.department_id || deptUsersLoading}
                    onChange={(e) => setContactDraft({ ...contactDraft, user_id: e.target.value })}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <option value="">
                      {!contactDraft.department_id ? "Select a department first…" : deptUsersLoading ? "Loading…" : "Select a department member…"}
                    </option>
                    {pickableUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name ?? u.email ?? u.phone_e164}</option>
                    ))}
                  </select>
                  {contactDraft.department_id && !deptUsersLoading && pickableUsers.length === 0 && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {deptUsers.length === 0
                        ? "No members in this department yet — add them on the Departments page."
                        : "All members of this department are already contacts."}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                      <input required type="text" value={contactDraft.name} onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })} placeholder="Full name" className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{contactDraft.also_user ? "Department role" : "Role / Title"}</label>
                      {contactDraft.also_user ? (
                        <select value={contactDraft.dept_role} onChange={(e) => setContactDraft({ ...contactDraft, dept_role: e.target.value })} className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm">
                          <option value="member">Member</option>
                          <option value="pm">PM</option>
                          <option value="hod">HOD</option>
                        </select>
                      ) : (
                        <input type="text" value={contactDraft.role} onChange={(e) => setContactDraft({ ...contactDraft, role: e.target.value })} placeholder="e.g. Transport HOD" className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Phone {contactDraft.also_user ? "*" : ""}</label>
                      <input required={contactDraft.also_user} type="text" value={contactDraft.phone_e164} onChange={(e) => setContactDraft({ ...contactDraft, phone_e164: e.target.value })} placeholder="+1234567890" className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                      <input type="email" value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })} className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                    </div>
                    {!contactDraft.also_user && (
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                        <input type="text" value={contactDraft.notes} onChange={(e) => setContactDraft({ ...contactDraft, notes: e.target.value })} placeholder="Optional notes" className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                      </div>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" checked={contactDraft.also_user} onChange={(e) => setContactDraft({ ...contactDraft, also_user: e.target.checked })} />
                    Also add as a department user (creates a portal user + department membership)
                  </label>
                </>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddContact(false)} className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300">Cancel</button>
                <button type="submit" disabled={savingContact} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300">
                  {savingContact ? "Saving…" : "Add"}
                </button>
              </div>
            </form>
          </div>
        )}

        {editingContact && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-lg">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Edit Contact</h3>
              <form onSubmit={saveContact} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                    <input required type="text" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Role / Title</label>
                    <input type="text" value={editDraft.role} onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })} className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
                    <input type="text" value={editDraft.phone_e164} onChange={(e) => setEditDraft({ ...editDraft, phone_e164: e.target.value })} className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                    <input type="email" value={editDraft.email} onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })} className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                    <input type="text" value={editDraft.notes} onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })} className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditingContact(null)} className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300">Cancel</button>
                  <button type="submit" disabled={savingContact} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300">
                    {savingContact ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {Object.keys(contactsByDept).length === 0 && !showAddContact ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No department contacts yet. Add one to help the escalation team know who to reach.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(contactsByDept)
              .sort(([, a], [, b]) => a.deptName.localeCompare(b.deptName))
              .map(([deptId, group]) => (
                <div key={deptId} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-800/60 px-4 py-2">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{group.deptName}</h3>
                  </div>
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
                      {group.contacts.map((contact) => (
                        <tr key={contact.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {contact.name ?? "—"}
                              {contact.kind === "member" && (
                                <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-green-700 dark:bg-green-900/40 dark:text-green-300">User</span>
                              )}
                            </p>
                            {contact.role && <p className="text-xs text-gray-500 dark:text-gray-400">{contact.role}</p>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                            {contact.phone_e164 ?? <span className="text-gray-400 dark:text-gray-500">—</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                            {contact.email ?? <span className="text-gray-400 dark:text-gray-500">—</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                            {contact.notes ?? ""}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {contact.kind === "reference" && (
                              <button
                                type="button"
                                onClick={() => openEditContact(contact)}
                                className="mr-3 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
                              >
                                Edit
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void removeContact(contact)}
                              disabled={removingContactId === contact.id}
                              className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 disabled:opacity-40"
                            >
                              {removingContactId === contact.id ? "Removing…" : "Remove"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        )}
      </section>
    </main>
  );
}
