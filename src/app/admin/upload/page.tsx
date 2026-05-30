"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FIXED_TRANSCRIPT_PROMPT, FIXED_MEETING_PROMPT, type TranscriptType } from "@/lib/transcripts/prompts";

type Department = { id: string; name: string };
type TaskPriority = "low" | "medium" | "high";

type ParsedEvent = {
  id: string;
  event_type: string;
  item_type: string;
  sender_alias: string | null;
  message_text: string | null;
  message_timestamp: string | null;
  ai_summary: string | null;
  task_title: string | null;
  assigned_to_alias: string | null;
  priority: TaskPriority;
  confidence: number;
  applied: boolean;
};

type NewMember = {
  alias: string;
  context: string;
};

type EventDraft = {
  priority: TaskPriority;
  assigned_to_alias: string;
};

type MemberDraft = {
  alias: string;
  context: string;
  display_name: string;
  phone_e164: string;
  department_id: string;
  dept_role: "member" | "pm" | "hod";
  add: boolean;
};

type ApplyResult = {
  tasks_created: number;
  tasks_updated: number;
  milestones_created: number;
  milestones_updated: number;
  issues_created: number;
  issues_updated: number;
};

export default function UploadPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [transcriptType, setTranscriptType] = useState<TranscriptType>("whatsapp");
  const [flexiblePrompt, setFlexiblePrompt] = useState("");
  const [promptSaved, setPromptSaved] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [eventDrafts, setEventDrafts] = useState<Record<string, EventDraft>>({});
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [newMembers, setNewMembers] = useState<MemberDraft[]>([]);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [memberResult, setMemberResult] = useState<string | null>(null);

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  const selectedDepartment = useMemo(
    () => departments.find((department) => department.id === selectedDept),
    [departments, selectedDept],
  );

  async function apiFetch(path: string, init?: RequestInit) {
    return fetch(path, {
      ...init,
      headers: {
        "x-admin-key": adminKey,
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers ?? {}),
      },
    });
  }

  async function fetchDepartments() {
    const res = await apiFetch("/api/departments");
    if (res.ok) {
      const data = await res.json() as Department[];
      setDepartments(data);
      if (!selectedDept && data[0]) {
        setSelectedDept(data[0].id);
      }
    }
  }

  async function fetchPromptConfig(departmentId: string, type: TranscriptType = transcriptType) {
    setPromptSaved(false);
    const res = await apiFetch(`/api/departments/${departmentId}/prompt-config?transcript_type=${type}`);
    if (res.ok) {
      const data = await res.json() as { flexible_prompt: string };
      setFlexiblePrompt(data.flexible_prompt);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    const userRaw = localStorage.getItem("admin_user");
    if (userRaw) {
      const user = JSON.parse(userRaw) as { global_role?: string };
      if (user.global_role === "member") {
        router.push("/admin/tasks");
        return;
      }
    }

    void Promise.resolve().then(fetchDepartments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!selectedDept) return;
    void Promise.resolve().then(() => fetchPromptConfig(selectedDept, transcriptType));
    void Promise.resolve().then(() => {
      setNewMembers((members) => members.map((member) => ({ ...member, department_id: selectedDept })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDept, transcriptType]);

  async function savePromptConfig() {
    if (!selectedDept) return;
    const res = await apiFetch(`/api/departments/${selectedDept}/prompt-config`, {
      method: "PUT",
      body: JSON.stringify({ flexible_prompt: flexiblePrompt, transcript_type: transcriptType }),
    });
    if (res.ok) {
      setPromptSaved(true);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !selectedDept) return;
    setLoading(true);
    setApplyResult(null);
    setMemberResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("department_id", selectedDept);
      formData.append("transcript_type", transcriptType);

      const res = await apiFetch("/api/transcripts/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json() as {
          upload_id: string;
          events: ParsedEvent[];
          new_members: NewMember[];
        };
        setUploadId(data.upload_id);
        setEvents(data.events);

        const drafts: Record<string, EventDraft> = {};
        for (const event of data.events) {
          drafts[event.id] = {
            priority: event.priority ?? "medium",
            assigned_to_alias: event.assigned_to_alias ?? "",
          };
        }
        setEventDrafts(drafts);

        setSelectedEvents(new Set(data.events.filter((event) => event.confidence >= 0.7).map((event) => event.id)));
        setNewMembers(data.new_members.map((member) => ({
          alias: member.alias,
          context: member.context,
          display_name: member.alias,
          phone_e164: "",
          department_id: selectedDept,
          dept_role: "member",
          add: false,
        })));
      } else {
        const err = await res.json() as { error?: string };
        alert(err.error || "Upload failed");
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!uploadId || selectedEvents.size === 0) return;
    setLoading(true);

    try {
      const res = await apiFetch(`/api/transcripts/${uploadId}/apply`, {
        method: "POST",
        body: JSON.stringify({
          selected_events: Array.from(selectedEvents).map((eventId) => ({
            event_id: eventId,
            priority: eventDrafts[eventId]?.priority ?? "medium",
            assigned_to_alias: eventDrafts[eventId]?.assigned_to_alias || undefined,
          })),
        }),
      });

      if (res.ok) {
        const result = await res.json() as ApplyResult;
        setApplyResult(result);
        const eventsRes = await apiFetch(`/api/transcripts/${uploadId}/events`);
        if (eventsRes.ok) {
          setEvents(await eventsRes.json() as ParsedEvent[]);
        }
      }
    } catch (err) {
      console.error("Apply error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMembers() {
    const selectedMembers = newMembers.filter((member) => member.add);
    if (selectedMembers.length === 0) return;

    setLoading(true);
    try {
      const res = await apiFetch("/api/users/bulk-create", {
        method: "POST",
        body: JSON.stringify({
          members: selectedMembers.map((member) => ({
            display_name: member.display_name,
            phone_e164: member.phone_e164,
            department_id: member.department_id,
            dept_role: member.dept_role,
            transcript_aliases: [member.alias],
          })),
        }),
      });

      if (res.ok) {
        const data = await res.json() as { created: unknown[] };
        setMemberResult(`${data.created.length} members added or updated.`);
        setNewMembers((members) => members.map((member) => ({ ...member, add: false })));
      } else {
        const error = await res.json() as { error?: string };
        alert(error.error || "Could not add members");
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleEvent(id: string) {
    const next = new Set(selectedEvents);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedEvents(next);
  }

  function updateEventDraft(id: string, patch: Partial<EventDraft>) {
    setEventDrafts((drafts) => ({
      ...drafts,
      [id]: { ...drafts[id], ...patch },
    }));
  }

  function updateMemberDraft(index: number, patch: Partial<MemberDraft>) {
    setNewMembers((members) => members.map((member, memberIndex) => memberIndex === index ? { ...member, ...patch } : member));
  }

  return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-center gap-1 rounded-lg border bg-white p-1 shadow-sm w-fit dark:border-gray-700 dark:bg-gray-900">
          <button
            type="button"
            onClick={() => setTranscriptType("whatsapp")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              transcriptType === "whatsapp"
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            }`}
          >
            WhatsApp Transcript
          </button>
          <button
            type="button"
            onClick={() => setTranscriptType("meeting")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              transcriptType === "meeting"
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            }`}
          >
            Meeting Transcript
          </button>
        </div>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Fixed Prompt ({transcriptType === "meeting" ? "Meeting" : "WhatsApp"})</h2>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400" title="This core prompt cannot be modified">Locked</span>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md bg-gray-100 p-3 text-xs leading-5 text-gray-700 whitespace-pre-wrap dark:bg-gray-800 dark:text-gray-300">
              {transcriptType === "meeting" ? FIXED_MEETING_PROMPT : FIXED_TRANSCRIPT_PROMPT}
            </pre>
          </div>

          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Department Rules</h2>
              <span className="text-xs text-gray-500">{flexiblePrompt.length}/4000</span>
            </div>
            <textarea
              value={flexiblePrompt}
              onChange={(event) => {
                setPromptSaved(false);
                setFlexiblePrompt(event.target.value.slice(0, 4000));
              }}
              rows={10}
              className="w-full rounded-md border px-3 py-2 text-sm"
              disabled={!selectedDept}
            />
            <div className="mt-3 flex justify-end gap-3">
              {promptSaved && <span className="self-center text-sm text-green-700">Saved</span>}
              <button
                type="button"
                onClick={savePromptConfig}
                disabled={!selectedDept || loading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Save Rules
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border bg-white p-6 shadow-sm">
          <form onSubmit={handleUpload} className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <label className="block text-sm font-medium">
              Department
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border px-3 py-2"
              >
                <option value="">Select department...</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Transcript File (.txt)
              <input
                type="file"
                accept=".txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                className="mt-1 block w-full rounded-md border px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={loading || !file || !selectedDept}
              className="rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Parsing..." : "Parse with AI"}
            </button>
          </form>
          {selectedDepartment && <p className="mt-3 text-sm text-gray-500">Rules will apply to {selectedDepartment.name}.</p>}
        </section>

        {applyResult && (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <p className="font-medium text-green-700 dark:text-green-300">
              {applyResult.tasks_created} tasks created, {applyResult.tasks_updated} tasks updated
              {(applyResult.milestones_created > 0 || applyResult.milestones_updated > 0) && (
                <>, {applyResult.milestones_created} milestones created, {applyResult.milestones_updated} milestones updated</>
              )}
              {(applyResult.issues_created > 0 || applyResult.issues_updated > 0) && (
                <>, {applyResult.issues_created} issues created, {applyResult.issues_updated} issues updated</>
              )}
            </p>
          </div>
        )}

        {events.length > 0 && (
          <section className="mt-6 rounded-lg border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Review Tasks ({events.length})</h2>
              <button
                onClick={handleApply}
                disabled={loading || selectedEvents.size === 0}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Apply Selected ({selectedEvents.size})
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Apply</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Sender</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Message</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">AI Summary</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Assigned To</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {events.map((event) => (
                    <tr key={event.id} className={event.confidence < 0.7 ? "bg-yellow-50" : ""}>
                      <td className="px-4 py-3">
                        {!event.applied ? (
                          <input type="checkbox" checked={selectedEvents.has(event.id)} onChange={() => toggleEvent(event.id)} />
                        ) : (
                          <span className="text-sm text-green-600">Applied</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {event.message_timestamp ? new Date(event.message_timestamp).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">{event.sender_alias ?? "—"}</td>
                      <td className="max-w-xs px-4 py-3 text-sm text-gray-600">{event.message_text ?? "—"}</td>
                      <td className="max-w-xs px-4 py-3 text-sm">{event.ai_summary ?? event.task_title ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-1 text-xs font-medium ${
                          event.item_type === "milestone" ? "bg-teal-100 text-teal-700" :
                          event.item_type === "issue" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>{event.item_type || "task"}</span>
                      </td>
                      <td className="px-4 py-3"><span className="rounded bg-gray-100 px-2 py-1 text-xs">{event.event_type}</span></td>
                      <td className="px-4 py-3">
                        <select
                          value={eventDrafts[event.id]?.priority ?? event.priority}
                          onChange={(e) => updateEventDraft(event.id, { priority: e.target.value as TaskPriority })}
                          className="rounded-md border px-2 py-1 text-sm"
                          disabled={event.applied}
                        >
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={eventDrafts[event.id]?.assigned_to_alias ?? ""}
                          onChange={(e) => updateEventDraft(event.id, { assigned_to_alias: e.target.value })}
                          className="w-40 rounded-md border px-2 py-1 text-sm"
                          placeholder="Alias"
                          disabled={event.applied}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm">{event.confidence < 0.7 ? "⚠ " : ""}{(event.confidence * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {newMembers.length > 0 && (
          <section className="mt-6 rounded-lg border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">New Members Detected ({newMembers.length})</h2>
              <button
                onClick={handleAddMembers}
                disabled={loading || newMembers.every((member) => !member.add)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Add Selected Members
              </button>
            </div>
            {memberResult && <p className="px-6 py-3 text-sm font-medium text-green-700">{memberResult}</p>}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Add</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Alias</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Context</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Display Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Department</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {newMembers.map((member, index) => (
                    <tr key={`${member.alias}-${index}`}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={member.add} onChange={(e) => updateMemberDraft(index, { add: e.target.checked })} />
                      </td>
                      <td className="px-4 py-3 text-sm">{member.alias}</td>
                      <td className="max-w-xs px-4 py-3 text-sm text-gray-600">{member.context}</td>
                      <td className="px-4 py-3">
                        <input value={member.display_name} onChange={(e) => updateMemberDraft(index, { display_name: e.target.value })} className="w-44 rounded-md border px-2 py-1 text-sm" />
                      </td>
                      <td className="px-4 py-3">
                        <input value={member.phone_e164} onChange={(e) => updateMemberDraft(index, { phone_e164: e.target.value })} className="w-40 rounded-md border px-2 py-1 text-sm" placeholder="+13125551212" />
                      </td>
                      <td className="px-4 py-3">
                        <select value={member.department_id} onChange={(e) => updateMemberDraft(index, { department_id: e.target.value })} className="w-44 rounded-md border px-2 py-1 text-sm">
                          {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select value={member.dept_role} onChange={(e) => updateMemberDraft(index, { dept_role: e.target.value as MemberDraft["dept_role"] })} className="rounded-md border px-2 py-1 text-sm">
                          <option value="member">Member</option>
                          <option value="pm">PM</option>
                          <option value="hod">HOD</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
  );
}
