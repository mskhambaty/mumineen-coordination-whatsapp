"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FIXED_MEETING_PROMPT, FIXED_TRANSCRIPT_PROMPT, type TranscriptType } from "@/lib/transcripts/prompts";

type Department = { id: string; name: string };
type User = { id: string; display_name: string; phone_e164?: string | null };
type TaskPriority = "low" | "medium" | "high";
type ItemStatus = "open" | "in_progress" | "blocked" | "complete";

type ParsedEvent = {
  id: string;
  event_type: string;
  item_type: "task" | "issue" | "milestone";
  department_id: string;
  review_action: "create" | "update";
  review_kind: "task" | "issue" | "milestone";
  target_id: string | null;
  target_title: string | null;
  target_status: string | null;
  review_label: string;
  task_title: string | null;
  milestone_title: string | null;
  ai_summary: string | null;
  message_text: string | null;
  assigned_to_alias: string | null;
  priority: TaskPriority;
  confidence: number;
  percent_complete: number | null;
  budget: number | null;
  notes: string | null;
  description: string | null;
  suggested_status: ItemStatus | null;
  due_date: string | null;
  assigned_to_user_id: string | null;
  milestone_id: string | null;
  applied: boolean;
};

type ExistingTask = {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  item_type: "task" | "issue" | null;
  due_date: string | null;
  priority: TaskPriority | null;
};

type ExistingMilestone = {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  percent_complete: number | null;
  budget: number | string | null;
  notes: string | null;
  tasks: ExistingTask[];
  issues: ExistingTask[];
};

type ExistingDepartmentTree = {
  department: Department;
  milestones: ExistingMilestone[];
  unassigned_tasks: ExistingTask[];
  unassigned_issues: ExistingTask[];
};

type EventDraft = {
  title: string;
  description: string;
  status: ItemStatus;
  priority: TaskPriority;
  due_date: string;
  budget: string;
  percent_complete: string;
  notes: string;
  milestone_id: string;
  assigned_to_alias: string;
  assigned_to_user_id: string;
  new_user_phone: string;
};

type ApplyResult = {
  tasks_created: number;
  tasks_updated: number;
  milestones_created: number;
  milestones_updated: number;
  issues_created: number;
  issues_updated: number;
  events_skipped?: number;
};

export default function UploadPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);
  const [transcriptType, setTranscriptType] = useState<TranscriptType>("whatsapp");
  const [flexiblePrompt, setFlexiblePrompt] = useState("");
  const [promptSaved, setPromptSaved] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [existingItems, setExistingItems] = useState<ExistingDepartmentTree[]>([]);
  const [eventDrafts, setEventDrafts] = useState<Record<string, EventDraft>>({});
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [parseFinished, setParseFinished] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";
  const promptDepartmentId = selectedDepartmentIds[0] ?? "";

  const selectedDepartments = useMemo(
    () => departments.filter((department) => selectedDepartmentIds.includes(department.id)),
    [departments, selectedDepartmentIds],
  );

  const allMilestones = useMemo(
    () => existingItems.flatMap((departmentTree) => departmentTree.milestones),
    [existingItems],
  );

  const eventGroups = useMemo(() => [
    { key: "milestone", title: "Milestones", events: events.filter((event) => event.review_kind === "milestone") },
    { key: "task", title: "Tasks", events: events.filter((event) => event.review_kind === "task") },
    { key: "issue", title: "Issues", events: events.filter((event) => event.review_kind === "issue") },
  ], [events]);

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
    if (!res.ok) return;
    const data = await res.json() as Department[];
    setDepartments(data);
    if (selectedDepartmentIds.length === 0 && data[0]) {
      setSelectedDepartmentIds([data[0].id]);
    }
  }

  async function fetchUsers() {
    const res = await apiFetch("/api/admin/users?department_id=all");
    if (res.ok) setUsers(await res.json() as User[]);
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
    void Promise.resolve().then(fetchUsers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!promptDepartmentId) return;
    void Promise.resolve().then(() => fetchPromptConfig(promptDepartmentId, transcriptType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptDepartmentId, transcriptType]);

  function toggleDepartment(departmentId: string) {
    setSelectedDepartmentIds((ids) => {
      if (ids.includes(departmentId)) return ids.filter((id) => id !== departmentId);
      return [...ids, departmentId];
    });
  }

  async function savePromptConfig() {
    if (!promptDepartmentId) return;
    const res = await apiFetch(`/api/departments/${promptDepartmentId}/prompt-config`, {
      method: "PUT",
      body: JSON.stringify({ flexible_prompt: flexiblePrompt, transcript_type: transcriptType }),
    });
    if (res.ok) setPromptSaved(true);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || selectedDepartmentIds.length === 0) return;
    setLoading(true);
    setParseFinished(false);
    setApplyResult(null);
    setEvents([]);
    setExistingItems([]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("department_ids", JSON.stringify(selectedDepartmentIds));
      formData.append("department_id", selectedDepartmentIds[0]);
      formData.append("transcript_type", transcriptType);

      const res = await apiFetch("/api/transcripts/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(err.error || "Upload failed");
        return;
      }

      const data = await res.json() as {
        upload_id: string;
        events: ParsedEvent[];
        existing_items: ExistingDepartmentTree[];
      };
      setUploadId(data.upload_id);
      setEvents(data.events);
      setExistingItems(data.existing_items ?? []);
      setParseFinished(true);

      const drafts: Record<string, EventDraft> = {};
      for (const event of data.events) {
        drafts[event.id] = {
          title: getEventTitle(event),
          description: event.description ?? event.message_text ?? "",
          status: event.suggested_status ?? inferStatus(event),
          priority: event.priority ?? "medium",
          due_date: event.due_date ?? "",
          budget: event.budget == null ? "" : String(event.budget),
          percent_complete: event.percent_complete == null ? "" : String(event.percent_complete),
          notes: event.notes ?? "",
          milestone_id: event.review_kind === "milestone" ? "" : event.milestone_id ?? "",
          assigned_to_alias: event.assigned_to_alias ?? "",
          assigned_to_user_id: event.assigned_to_user_id ?? "",
          new_user_phone: "",
        };
      }
      setEventDrafts(drafts);
      setSelectedEvents(new Set(data.events.filter((event) => event.confidence >= 0.7 && !event.applied).map((event) => event.id)));
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
          selected_events: Array.from(selectedEvents).map((eventId) => {
            const draft = eventDrafts[eventId];
            return {
              event_id: eventId,
              title: draft?.title,
              description: draft?.description,
              status: draft?.status,
              priority: draft?.priority,
              due_date: draft?.due_date || null,
              budget: draft?.budget ? Number(draft.budget) : null,
              percent_complete: draft?.percent_complete ? Number(draft.percent_complete) : null,
              notes: draft?.notes || null,
              milestone_id: draft?.milestone_id || null,
              assigned_to_alias: draft?.assigned_to_alias || undefined,
              assigned_to_user_id: draft?.assigned_to_user_id || null,
            };
          }),
        }),
      });

      if (res.ok) {
        const result = await res.json() as ApplyResult;
        setApplyResult(result);
        const eventsRes = await apiFetch(`/api/transcripts/${uploadId}/events`);
        if (eventsRes.ok) {
          setEvents(await eventsRes.json() as ParsedEvent[]);
        }
      } else {
        const err = await res.json() as { error?: string };
        alert(err.error || "Could not submit changes");
      }
    } finally {
      setLoading(false);
    }
  }

  async function createUserFromAlias(eventId: string) {
    const draft = eventDrafts[eventId];
    if (!draft?.assigned_to_alias || !draft.new_user_phone) {
      alert("Enter an assignee alias and phone number first.");
      return;
    }

    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        display_name: draft.assigned_to_alias,
        phone_e164: draft.new_user_phone,
        role: "committee",
        global_role: "member",
      }),
    });

    if (!res.ok) {
      const err = await res.json() as { error?: string };
      alert(err.error || "Could not create user");
      return;
    }

    const user = await res.json() as User;
    setUsers((current) => [...current, user].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    updateEventDraft(eventId, { assigned_to_user_id: user.id, new_user_phone: "" });
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

  function getEventTitle(event: ParsedEvent) {
    return event.milestone_title || event.task_title || event.ai_summary || event.message_text || "Untitled proposal";
  }

  function inferStatus(event: ParsedEvent): ItemStatus {
    if (event.event_type === "issue_resolved" || event.event_type === "task_completed") return "complete";
    if (event.event_type.includes("updated")) return "in_progress";
    return "open";
  }

  function actionClasses(event: ParsedEvent) {
    return event.review_action === "update"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-emerald-300 bg-emerald-50 text-emerald-900";
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex w-fit items-center gap-1 rounded-lg border bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <button
          type="button"
          onClick={() => setTranscriptType("whatsapp")}
          className={`rounded-md px-4 py-2 text-sm font-medium ${transcriptType === "whatsapp" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
        >
          WhatsApp Transcript
        </button>
        <button
          type="button"
          onClick={() => setTranscriptType("meeting")}
          className={`rounded-md px-4 py-2 text-sm font-medium ${transcriptType === "meeting" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
        >
          Meeting Transcript
        </button>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Fixed Prompt ({transcriptType === "meeting" ? "Meeting" : "WhatsApp"})</h2>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">Locked</span>
          </div>
          <pre className="max-h-72 overflow-auto rounded-md bg-gray-100 p-3 text-xs leading-5 text-gray-700 whitespace-pre-wrap dark:bg-gray-800 dark:text-gray-300">
            {transcriptType === "meeting" ? FIXED_MEETING_PROMPT : FIXED_TRANSCRIPT_PROMPT}
          </pre>
        </div>

        <div className="rounded-lg border bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Department Rules</h2>
            <span className="text-xs text-gray-500">{promptDepartmentId ? selectedDepartments[0]?.name : "Select a department"}</span>
          </div>
          <textarea
            value={flexiblePrompt}
            onChange={(event) => {
              setPromptSaved(false);
              setFlexiblePrompt(event.target.value.slice(0, 4000));
            }}
            rows={10}
            className="w-full rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            disabled={!promptDepartmentId}
          />
          <div className="mt-3 flex justify-end gap-3">
            {promptSaved && <span className="self-center text-sm text-green-700">Saved</span>}
            <button
              type="button"
              onClick={savePromptConfig}
              disabled={!promptDepartmentId || loading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save Rules
            </button>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <form onSubmit={handleUpload} className="grid gap-5 lg:grid-cols-[1.4fr_1fr_auto] lg:items-end">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Departments</span>
              <button
                type="button"
                onClick={() => setSelectedDepartmentIds(selectedDepartmentIds.length === departments.length ? [] : departments.map((department) => department.id))}
                disabled={departments.length === 0}
                className="text-sm font-medium text-blue-700 hover:text-blue-800"
              >
                {departments.length > 0 && selectedDepartmentIds.length === departments.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="grid max-h-52 gap-2 overflow-auto rounded-md border p-3 sm:grid-cols-2">
              {departments.length === 0 && <p className="text-sm text-gray-500">No departments loaded.</p>}
              {departments.map((department) => (
                <label key={department.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedDepartmentIds.includes(department.id)}
                    onChange={() => toggleDepartment(department.id)}
                  />
                  {department.name}
                </label>
              ))}
            </div>
          </div>
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
            disabled={loading || !file || selectedDepartmentIds.length === 0}
            className="rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Parsing..." : "Parse with AI"}
          </button>
        </form>
        <p className="mt-3 text-sm text-gray-500">
          The selected departments define the existing milestones, tasks, and issues sent to the extractor.
        </p>
      </section>

      {applyResult && (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
          <p className="font-medium text-green-700 dark:text-green-300">
            {applyResult.tasks_created} tasks created, {applyResult.tasks_updated} tasks updated, {applyResult.issues_created} issues created, {applyResult.issues_updated} issues updated, {applyResult.milestones_created} milestones created, {applyResult.milestones_updated} milestones updated.
            {applyResult.events_skipped ? ` ${applyResult.events_skipped} skipped.` : ""}
          </p>
        </div>
      )}

      {existingItems.length > 0 && (
        <section className="mt-6 rounded-lg border bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-semibold">Existing Work Sent to Extractor</h2>
            <p className="mt-1 text-sm text-gray-500">Open milestones are shown with their current tasks and issues.</p>
          </div>
          <div className="divide-y">
            {existingItems.map((departmentTree) => (
              <div key={departmentTree.department.id} className="px-6 py-4">
                <h3 className="font-semibold">{departmentTree.department.name}</h3>
                {departmentTree.milestones.length === 0 && departmentTree.unassigned_tasks.length === 0 && departmentTree.unassigned_issues.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500">No open existing items.</p>
                )}
                <div className="mt-3 grid gap-3">
                  {departmentTree.milestones.map((milestone) => (
                    <div key={milestone.id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{milestone.title}</span>
                        <span className="rounded bg-gray-100 px-2 py-1 text-xs">{milestone.status}</span>
                        <span className="text-xs text-gray-500">{milestone.percent_complete ?? 0}% complete</span>
                      </div>
                      {(milestone.tasks.length > 0 || milestone.issues.length > 0) && (
                        <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                          <ExistingList title="Tasks" items={milestone.tasks} />
                          <ExistingList title="Issues" items={milestone.issues} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {parseFinished && events.length === 0 && (
        <section className="mt-6 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold">No Proposed Changes Found</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            The transcript parsed successfully, but no new or updated milestones, tasks, or issues were returned.
          </p>
        </section>
      )}

      {events.length > 0 && (
        <section className="mt-6 rounded-lg border bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">Review AI Suggested Changes ({events.length})</h2>
              <p className="mt-1 text-sm text-gray-500">Edit fields, map friendly assignee aliases, then submit only the selected changes.</p>
            </div>
            <button
              onClick={handleApply}
              disabled={loading || selectedEvents.size === 0}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Submit Selected ({selectedEvents.size})
            </button>
          </div>
          <div className="grid gap-3 border-b px-6 py-4 text-sm sm:grid-cols-3">
            <div><span className="font-semibold">{events.filter((event) => event.review_action === "create").length}</span> new items</div>
            <div><span className="font-semibold">{events.filter((event) => event.review_action === "update").length}</span> suggested updates</div>
            <div><span className="font-semibold">{events.filter((event) => event.confidence >= 0.7).length}</span> high confidence</div>
          </div>

          {eventGroups.filter((group) => group.events.length > 0).map((group) => (
            <div key={group.key} className="border-b px-6 py-5 last:border-b-0">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">{group.title} ({group.events.length})</h3>
              <div className="mt-3 grid gap-4">
                {group.events.map((event) => {
                  const draft = eventDrafts[event.id];
                  return (
                    <div key={event.id} className={`rounded-lg border p-4 ${event.confidence < 0.7 ? "bg-yellow-50" : "bg-white dark:bg-gray-900"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <input type="checkbox" checked={selectedEvents.has(event.id)} onChange={() => toggleEvent(event.id)} disabled={event.applied} />
                          {event.applied ? "Applied" : "Include"}
                        </label>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full border px-2 py-1 font-medium ${actionClasses(event)}`}>{event.review_action === "update" ? "Suggested update" : "New item"}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-1">{event.event_type}</span>
                          <span>{(event.confidence * 100).toFixed(0)}% confidence</span>
                        </div>
                      </div>

                      {event.review_action === "update" && (
                        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          Existing match: {event.target_title ?? "No match found"}{event.target_status ? ` (${event.target_status})` : ""}
                        </p>
                      )}

                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <label className="text-sm font-medium">
                          Title
                          <input value={draft?.title ?? ""} onChange={(e) => updateEventDraft(event.id, { title: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied} />
                        </label>
                        <label className="text-sm font-medium">
                          Status
                          <select value={draft?.status ?? "open"} onChange={(e) => updateEventDraft(event.id, { status: e.target.value as ItemStatus })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied}>
                            <option value="open">Open</option>
                            <option value="in_progress">In progress</option>
                            <option value="blocked">Blocked</option>
                            <option value="complete">Complete</option>
                          </select>
                        </label>
                        {event.review_kind !== "milestone" && (
                          <>
                            <label className="text-sm font-medium">
                              Priority
                              <select value={draft?.priority ?? "medium"} onChange={(e) => updateEventDraft(event.id, { priority: e.target.value as TaskPriority })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied}>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                              </select>
                            </label>
                            <label className="text-sm font-medium">
                              Milestone
                              <select value={draft?.milestone_id ?? ""} onChange={(e) => updateEventDraft(event.id, { milestone_id: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied}>
                                <option value="">No milestone</option>
                                {allMilestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
                              </select>
                            </label>
                            <label className="text-sm font-medium">
                              Assignee alias from transcript
                              <input value={draft?.assigned_to_alias ?? ""} onChange={(e) => updateEventDraft(event.id, { assigned_to_alias: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied} />
                            </label>
                            <label className="text-sm font-medium">
                              Assign system user
                              <select value={draft?.assigned_to_user_id ?? ""} onChange={(e) => updateEventDraft(event.id, { assigned_to_user_id: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied}>
                                <option value="">Unassigned</option>
                                {users.map((user) => <option key={user.id} value={user.id}>{user.display_name}</option>)}
                              </select>
                            </label>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <label className="text-sm font-medium">
                                New user phone
                                <input value={draft?.new_user_phone ?? ""} onChange={(e) => updateEventDraft(event.id, { new_user_phone: e.target.value })} placeholder="+13125551212" className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied} />
                              </label>
                              <button type="button" onClick={() => createUserFromAlias(event.id)} disabled={event.applied || loading} className="self-end rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50">
                                Create User
                              </button>
                            </div>
                            <label className="text-sm font-medium">
                              Due date
                              <input type="date" value={draft?.due_date ?? ""} onChange={(e) => updateEventDraft(event.id, { due_date: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied} />
                            </label>
                          </>
                        )}
                        {event.review_kind === "milestone" && (
                          <>
                            <label className="text-sm font-medium">
                              Budget
                              <input type="number" value={draft?.budget ?? ""} onChange={(e) => updateEventDraft(event.id, { budget: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied} />
                            </label>
                            <label className="text-sm font-medium">
                              Percent complete
                              <input type="number" min="0" max="100" value={draft?.percent_complete ?? ""} onChange={(e) => updateEventDraft(event.id, { percent_complete: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied} />
                            </label>
                          </>
                        )}
                        <label className="text-sm font-medium lg:col-span-2">
                          Description
                          <textarea value={draft?.description ?? ""} onChange={(e) => updateEventDraft(event.id, { description: e.target.value })} rows={3} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied} />
                        </label>
                        <label className="text-sm font-medium lg:col-span-2">
                          Notes
                          <textarea value={draft?.notes ?? ""} onChange={(e) => updateEventDraft(event.id, { notes: e.target.value })} rows={2} className="mt-1 w-full rounded-md border px-3 py-2" disabled={event.applied} />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

function ExistingList({ title, items }: { title: string; items: ExistingTask[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-medium text-gray-700">{title}</p>
      <ul className="mt-1 space-y-1 text-gray-600">
        {items.map((item) => (
          <li key={item.id} className="rounded bg-gray-50 px-2 py-1">
            {item.title} <span className="text-xs text-gray-400">({item.status})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
