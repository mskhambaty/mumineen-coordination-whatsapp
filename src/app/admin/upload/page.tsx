"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { canManageInternalTools } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
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
  percent_complete: number | null;
  budget: number | null;
  notes: string | null;
  description: string | null;
  suggested_status: ItemStatus | null;
  due_date: string | null;
  assigned_to_user_id: string | null;
  milestone_id: string | null;
  temp_milestone_id: string | null;
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
  const [promptEditorDepartmentId, setPromptEditorDepartmentId] = useState("");
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
  const [manualCounter, setManualCounter] = useState(1);
  const [cutoffTimestamp, setCutoffTimestamp] = useState("");
  const [lastParsedLabel, setLastParsedLabel] = useState("");

  const promptDepartmentId = promptEditorDepartmentId && selectedDepartmentIds.includes(promptEditorDepartmentId)
    ? promptEditorDepartmentId
    : selectedDepartmentIds[0] ?? "";

  const selectedDepartments = useMemo(
    () => departments.filter((department) => selectedDepartmentIds.includes(department.id)),
    [departments, selectedDepartmentIds],
  );

  const promptEditorDepartment = useMemo(
    () => departments.find((department) => department.id === promptDepartmentId),
    [departments, promptDepartmentId],
  );

  const allMilestones = useMemo(
    () => existingItems.flatMap((departmentTree) => departmentTree.milestones),
    [existingItems],
  );

  type MergedItem = {
    existing: ExistingTask | null;
    event: ParsedEvent | null;
    changeType: "existing" | "new" | "updated";
  };

  type MergedMilestone = {
    key: string;
    title: string;
    existing: ExistingMilestone | null;
    event: ParsedEvent | null;
    changeType: "existing" | "new" | "updated";
    items: MergedItem[];
  };

  type MergedDepartment = {
    department: Department;
    milestones: MergedMilestone[];
    unassigned: MergedItem[];
    hasChanges: boolean;
  };

  const newMilestoneEvents = useMemo(
    () => events.filter((e) => e.review_kind === "milestone" && e.review_action === "create"),
    [events],
  );

  const allMilestonesForDropdown = useMemo(() => {
    const existing = allMilestones.map((ms) => ({ id: ms.id, title: ms.title ?? "Untitled" }));
    const newOnes = newMilestoneEvents.map((e) => {
      const key = e.temp_milestone_id ?? `event_${e.id}`;
      const draftTitle = eventDrafts[e.id]?.title;
      const displayTitle = draftTitle || e.milestone_title || e.task_title || e.ai_summary || "Untitled";
      return { id: key, title: `(New) ${displayTitle}` };
    });
    return [...existing, ...newOnes];
  }, [allMilestones, newMilestoneEvents, eventDrafts]);

  const mergedDepartments = useMemo((): MergedDepartment[] => {
    const deptMap = new Map<string, Department>();
    for (const tree of existingItems) deptMap.set(tree.department.id, tree.department);
    for (const event of events) {
      if (!deptMap.has(event.department_id)) {
        const dept = departments.find((d) => d.id === event.department_id);
        if (dept) deptMap.set(dept.id, dept);
      }
    }

    return Array.from(deptMap.values()).map((dept) => {
      const tree = existingItems.find((t) => t.department.id === dept.id);
      const deptEvents = events.filter((e) => e.department_id === dept.id);

      const milestoneMap = new Map<string, MergedMilestone>();

      for (const ms of tree?.milestones ?? []) {
        const existingItems: MergedItem[] = [
          ...ms.tasks.map((t) => ({ existing: t, event: null, changeType: "existing" as const })),
          ...ms.issues.map((t) => ({ existing: t, event: null, changeType: "existing" as const })),
        ];
        milestoneMap.set(ms.id, {
          key: ms.id,
          title: ms.title ?? "Untitled",
          existing: ms,
          event: null,
          changeType: "existing",
          items: existingItems,
        });
      }

      for (const e of deptEvents.filter((ev) => ev.review_kind === "milestone")) {
        if (e.review_action === "update" && e.target_id && milestoneMap.has(e.target_id)) {
          const ms = milestoneMap.get(e.target_id)!;
          ms.event = e;
          ms.changeType = "updated";
        } else if (e.review_action === "create") {
          const key = e.temp_milestone_id ?? `event_${e.id}`;
          milestoneMap.set(key, {
            key,
            title: e.milestone_title ?? e.task_title ?? e.ai_summary ?? "New Milestone",
            existing: null,
            event: e,
            changeType: "new",
            items: [],
          });
        }
      }

      for (const e of deptEvents.filter((ev) => ev.review_kind !== "milestone")) {
        let placed = false;

        if (e.review_action === "update" && e.target_id) {
          for (const ms of milestoneMap.values()) {
            const match = ms.items.find((item) => item.existing?.id === e.target_id);
            if (match) {
              match.event = e;
              match.changeType = "updated";
              placed = true;
              break;
            }
          }
        }

        if (!placed) {
          const msRef = e.temp_milestone_id ?? e.milestone_id;
          if (msRef && milestoneMap.has(msRef)) {
            milestoneMap.get(msRef)!.items.push({
              existing: null,
              event: e,
              changeType: e.review_action === "update" ? "updated" : "new",
            });
            placed = true;
          }
        }

        if (!placed) {
          const unassignedKey = "__unassigned__";
          if (!milestoneMap.has(unassignedKey)) {
            milestoneMap.set(unassignedKey, {
              key: unassignedKey,
              title: "Unassigned Items",
              existing: null,
              event: null,
              changeType: "existing",
              items: [],
            });
          }
          milestoneMap.get(unassignedKey)!.items.push({
            existing: null,
            event: e,
            changeType: e.review_action === "update" ? "updated" : "new",
          });
        }
      }

      const unassignedExisting: MergedItem[] = [
        ...(tree?.unassigned_tasks ?? []).map((t) => ({ existing: t, event: null, changeType: "existing" as const })),
        ...(tree?.unassigned_issues ?? []).map((t) => ({ existing: t, event: null, changeType: "existing" as const })),
      ];
      if (unassignedExisting.length > 0) {
        const unKey = "__unassigned__";
        if (!milestoneMap.has(unKey)) {
          milestoneMap.set(unKey, {
            key: unKey,
            title: "Unassigned Items",
            existing: null,
            event: null,
            changeType: "existing",
            items: [],
          });
        }
        milestoneMap.get(unKey)!.items.unshift(...unassignedExisting);
      }

      const milestones = Array.from(milestoneMap.values()).filter((ms) => ms.key !== "__unassigned__");
      const unassignedMs = milestoneMap.get("__unassigned__");
      const unassigned = unassignedMs?.items ?? [];
      const hasChanges = milestones.some((ms) => ms.changeType !== "existing" || ms.items.some((i) => i.changeType !== "existing")) || unassigned.some((i) => i.changeType !== "existing");

      return { department: dept, milestones, unassigned, hasChanges };
    }).filter((d) => d.milestones.length > 0 || d.unassigned.length > 0);
  }, [existingItems, events, departments]);

  async function fetchDepartments() {
    const res = await apiFetch("/api/departments");
    if (!res.ok) return;
    const data = await res.json() as Department[];
    setDepartments(data);
    if (selectedDepartmentIds.length === 0 && data[0]) {
      setSelectedDepartmentIds([data[0].id]);
      setPromptEditorDepartmentId(data[0].id);
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
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    if (!canManageInternalTools(user)) {
      router.push("/admin/registration");
      return;
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

  useEffect(() => {
    if (selectedDepartmentIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCutoffTimestamp("");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastParsedLabel("");
      return;
    }
    void (async () => {
      const res = await apiFetch(`/api/transcripts/last-parsed?department_ids=${selectedDepartmentIds.join(",")}`);
      if (res.ok) {
        const data = await res.json() as { last_message_at: string | null };
        if (data.last_message_at) {
          const dt = new Date(data.last_message_at);
          const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
          setCutoffTimestamp(local);
          setLastParsedLabel(`Last parsed: ${dt.toLocaleString()}`);
        } else {
          setCutoffTimestamp("");
          setLastParsedLabel("No previous uploads for selected departments");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartmentIds]);

  function toggleDepartment(departmentId: string) {
    setSelectedDepartmentIds((ids) => {
      if (ids.includes(departmentId)) {
        const next = ids.filter((id) => id !== departmentId);
        if (promptEditorDepartmentId === departmentId) {
          setPromptEditorDepartmentId(next[0] ?? "");
        }
        return next;
      }
      if (!promptEditorDepartmentId) {
        setPromptEditorDepartmentId(departmentId);
      }
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
      if (cutoffTimestamp) {
        formData.append("cutoff_timestamp", new Date(cutoffTimestamp).toISOString());
      }

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
          milestone_id: event.review_kind === "milestone" ? "" : (event.milestone_id ?? event.temp_milestone_id ?? ""),
          assigned_to_alias: event.assigned_to_alias ?? "",
          assigned_to_user_id: event.assigned_to_user_id ?? "",
          new_user_phone: "",
        };
      }
      setEventDrafts(drafts);
      setSelectedEvents(new Set(data.events.filter((event) => !event.applied).map((event) => event.id)));
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
          selected_events: Array.from(selectedEvents).filter((id) => !id.startsWith("manual_")).map((eventId) => {
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
          manual_events: Array.from(selectedEvents).filter((id) => id.startsWith("manual_")).map((eventId) => {
            const draft = eventDrafts[eventId];
            const ev = events.find((e) => e.id === eventId);
            return {
              item_type: ev?.item_type ?? "task",
              department_id: ev?.department_id,
              title: draft?.title || "Untitled",
              description: draft?.description || null,
              status: draft?.status ?? "open",
              priority: draft?.priority ?? "medium",
              due_date: draft?.due_date || null,
              milestone_id: draft?.milestone_id || null,
              assigned_to_alias: draft?.assigned_to_alias || null,
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
          const serverEvents = await eventsRes.json() as ParsedEvent[];
          const remainingManual = events.filter((e) => e.id.startsWith("manual_") && !selectedEvents.has(e.id));
          setEvents([...serverEvents, ...remainingManual]);
          setSelectedEvents((prev) => {
            const next = new Set<string>();
            for (const id of prev) {
              if (!id.startsWith("manual_")) next.add(id);
            }
            return next;
          });
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

  function toggleMilestoneGroup(milestoneEvent: ParsedEvent | null, childEvents: ParsedEvent[]) {
    const allIds = [...(milestoneEvent ? [milestoneEvent.id] : []), ...childEvents.map((e) => e.id)];
    const allSelected = allIds.every((id) => selectedEvents.has(id));
    const next = new Set(selectedEvents);
    for (const id of allIds) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    setSelectedEvents(next);
  }

  function addManualItem(departmentId: string, milestoneRef: string | null, itemType: "task" | "issue") {
    const id = `manual_${manualCounter}`;
    setManualCounter((c) => c + 1);

    const newEvent: ParsedEvent = {
      id,
      event_type: itemType === "issue" ? "issue_created" : "task_created",
      item_type: itemType,
      department_id: departmentId,
      review_action: "create",
      review_kind: itemType,
      target_id: null,
      target_title: null,
      target_status: null,
      review_label: `Create new ${itemType}`,
      task_title: null,
      milestone_title: null,
      ai_summary: null,
      message_text: null,
      assigned_to_alias: null,
      priority: "medium",
      percent_complete: null,
      budget: null,
      notes: null,
      description: null,
      suggested_status: "open",
      due_date: null,
      assigned_to_user_id: null,
      milestone_id: milestoneRef?.startsWith("temp_") ? null : milestoneRef,
      temp_milestone_id: milestoneRef?.startsWith("temp_") || milestoneRef?.startsWith("event_") ? milestoneRef : null,
      applied: false,
    };

    setEvents((prev) => [...prev, newEvent]);
    setEventDrafts((prev) => ({
      ...prev,
      [id]: {
        title: "",
        description: "",
        status: "open",
        priority: "medium",
        due_date: "",
        budget: "",
        percent_complete: "",
        notes: "",
        milestone_id: milestoneRef ?? "",
        assigned_to_alias: "",
        assigned_to_user_id: "",
        new_user_phone: "",
      },
    }));
    setSelectedEvents((prev) => new Set(prev).add(id));
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
          </div>
          {selectedDepartments.length === 0 && (
            <p className="text-sm text-gray-500">Select departments below to edit their rules.</p>
          )}
          {selectedDepartments.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap gap-1 rounded-lg border bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800">
                {selectedDepartments.map((department) => (
                  <button
                    key={department.id}
                    type="button"
                    onClick={() => setPromptEditorDepartmentId(department.id)}
                    disabled={loading}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${promptDepartmentId === department.id ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"}`}
                  >
                    {department.name}
                  </button>
                ))}
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
            </>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <form onSubmit={handleUpload} className="grid gap-5 lg:grid-cols-[1.4fr_1fr_auto] lg:items-end">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Departments</span>
              <button
                type="button"
                onClick={() => {
                  if (selectedDepartmentIds.length === departments.length) {
                    setSelectedDepartmentIds([]);
                    setPromptEditorDepartmentId("");
                    return;
                  }
                  const allDepartmentIds = departments.map((department) => department.id);
                  setSelectedDepartmentIds(allDepartmentIds);
                  setPromptEditorDepartmentId(promptEditorDepartmentId || allDepartmentIds[0] || "");
                }}
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
          <div className="grid gap-3">
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
            {transcriptType === "whatsapp" && selectedDepartmentIds.length > 0 && (
              <label className="block text-sm font-medium">
                Only parse messages after
                <input
                  type="datetime-local"
                  value={cutoffTimestamp}
                  onChange={(e) => setCutoffTimestamp(e.target.value)}
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                />
                <span className="mt-1 block text-xs text-gray-500">{lastParsedLabel || "Messages before this time will be excluded"}</span>
              </label>
            )}
          </div>
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

      {parseFinished && events.length === 0 && existingItems.length === 0 && (
        <section className="mt-6 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold">No Proposed Changes Found</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            The transcript parsed successfully, but no new or updated milestones, tasks, or issues were returned.
          </p>
        </section>
      )}

      {mergedDepartments.length > 0 && (
        <section className="mt-6 rounded-lg border bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">Related Work Items</h2>
              <p className="mt-1 text-sm text-gray-500">
                {events.length > 0
                  ? "Review proposed changes alongside existing work. Edit fields, then submit selected changes."
                  : "Existing milestones, tasks, and issues for selected departments."}
              </p>
            </div>
            {events.length > 0 && (
              <button
                onClick={handleApply}
                disabled={loading || selectedEvents.size === 0}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Submit Selected ({selectedEvents.size})
              </button>
            )}
          </div>
          {events.length > 0 && (
            <div className="grid gap-3 border-b px-6 py-4 text-sm sm:grid-cols-2">
              <div><span className="font-semibold">{events.filter((e) => e.review_action === "create").length}</span> new items</div>
              <div><span className="font-semibold">{events.filter((e) => e.review_action === "update").length}</span> suggested updates</div>
            </div>
          )}

          <div className="divide-y">
            {mergedDepartments.map((dept) => (
              <details key={dept.department.id} open className="group">
                <summary className="flex cursor-pointer items-center gap-2 px-6 py-4 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800">
                  <span className="transition-transform group-open:rotate-90">&#9654;</span>
                  {dept.department.name}
                  {dept.hasChanges && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">has changes</span>}
                </summary>
                <div className="px-6 pb-4">
                  {dept.milestones.length === 0 && dept.unassigned.length === 0 && (
                    <p className="text-sm text-gray-500">No items.</p>
                  )}
                  <div className="grid gap-3">
                    {dept.milestones.map((ms) => {
                      const childEvents = ms.items.filter((i) => i.event).map((i) => i.event!);
                      const allGroupEvents = [...(ms.event ? [ms.event] : []), ...childEvents];
                      const hasGroupChanges = ms.changeType !== "existing" || ms.items.some((i) => i.changeType !== "existing");
                      const allGroupIds = allGroupEvents.filter((e) => !e.applied).map((e) => e.id);
                      const allGroupSelected = allGroupIds.length > 0 && allGroupIds.every((id) => selectedEvents.has(id));
                      const someGroupSelected = allGroupIds.some((id) => selectedEvents.has(id));

                      return (
                        <details key={ms.key} open={hasGroupChanges}>
                          <summary className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                            {ms.changeType === "new" && allGroupIds.length > 0 && (
                              <input
                                type="checkbox"
                                checked={allGroupSelected}
                                ref={(el) => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                                onChange={() => toggleMilestoneGroup(ms.event, childEvents)}
                                onClick={(e) => e.stopPropagation()}
                                className="mr-1"
                              />
                            )}
                            <span className="font-medium">{ms.title}</span>
                            {ms.existing && (
                              <>
                                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{ms.existing.status}</span>
                                <span className="text-xs text-gray-500">{ms.existing.percent_complete ?? 0}%</span>
                              </>
                            )}
                            {ms.changeType === "new" && <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900">NEW</span>}
                            {ms.changeType === "updated" && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">UPDATE</span>}
                            <span className="ml-auto text-xs text-gray-400">{ms.items.length} item{ms.items.length !== 1 ? "s" : ""}</span>
                          </summary>
                          <div className="mt-2 ml-4 grid gap-2">
                            {ms.event && (
                              <EventEditor event={ms.event} draft={eventDrafts[ms.event.id]} isMilestone selectedEvents={selectedEvents} toggleEvent={toggleEvent} updateEventDraft={updateEventDraft} users={users} allMilestonesForDropdown={allMilestonesForDropdown} createUserFromAlias={createUserFromAlias} loading={loading} />
                            )}
                            {ms.items.map((item) => {
                              if (item.existing && !item.event) {
                                return (
                                  <div key={item.existing.id} className="flex items-center gap-2 rounded bg-gray-50 px-3 py-1.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                    <span className={`inline-block h-2 w-2 rounded-full ${item.existing.item_type === "issue" ? "bg-red-400" : "bg-blue-400"}`} />
                                    <span>{item.existing.title}</span>
                                    <span className="text-xs text-gray-400">({item.existing.status})</span>
                                    {item.existing.item_type === "issue" && <span className="text-xs text-red-500">issue</span>}
                                  </div>
                                );
                              }
                              if (item.event) {
                                return (
                                  <EventEditor key={item.event.id} event={item.event} draft={eventDrafts[item.event.id]} isMilestone={false} selectedEvents={selectedEvents} toggleEvent={toggleEvent} updateEventDraft={updateEventDraft} users={users} allMilestonesForDropdown={allMilestonesForDropdown} createUserFromAlias={createUserFromAlias} loading={loading} />
                                );
                              }
                              return null;
                            })}
                            <div className="flex gap-2 pt-1">
                              <button type="button" onClick={() => addManualItem(dept.department.id, ms.key, "task")} className="rounded border border-dashed border-blue-300 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950">
                                + Add Task
                              </button>
                              <button type="button" onClick={() => addManualItem(dept.department.id, ms.key, "issue")} className="rounded border border-dashed border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">
                                + Add Issue
                              </button>
                            </div>
                          </div>
                        </details>
                      );
                    })}

                    {dept.unassigned.length > 0 && (
                      <details open={dept.unassigned.some((i) => i.changeType !== "existing")}>
                        <summary className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
                          <span className="font-medium">Unassigned Items</span>
                          <span className="text-xs text-gray-400">{dept.unassigned.length} item{dept.unassigned.length !== 1 ? "s" : ""}</span>
                        </summary>
                        <div className="mt-2 ml-4 grid gap-2">
                          {dept.unassigned.map((item) => {
                            if (item.existing && !item.event) {
                              return (
                                <div key={item.existing.id} className="flex items-center gap-2 rounded bg-gray-50 px-3 py-1.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                  <span className={`inline-block h-2 w-2 rounded-full ${item.existing.item_type === "issue" ? "bg-red-400" : "bg-blue-400"}`} />
                                  <span>{item.existing.title}</span>
                                  <span className="text-xs text-gray-400">({item.existing.status})</span>
                                </div>
                              );
                            }
                            if (item.event) {
                              return (
                                <EventEditor key={item.event.id} event={item.event} draft={eventDrafts[item.event.id]} isMilestone={false} selectedEvents={selectedEvents} toggleEvent={toggleEvent} updateEventDraft={updateEventDraft} users={users} allMilestonesForDropdown={allMilestonesForDropdown} createUserFromAlias={createUserFromAlias} loading={loading} />
                              );
                            }
                            return null;
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </details>
            ))}
          {events.length > 0 && (
            <div className="flex justify-end border-t px-6 py-4">
              <button
                onClick={handleApply}
                disabled={loading || selectedEvents.size === 0}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Submit Selected ({selectedEvents.size})
              </button>
            </div>
          )}
          </div>
        </section>
      )}
    </main>
  );
}

type EventEditorProps = {
  event: ParsedEvent;
  draft: EventDraft | undefined;
  isMilestone: boolean;
  selectedEvents: Set<string>;
  toggleEvent: (id: string) => void;
  updateEventDraft: (id: string, patch: Partial<EventDraft>) => void;
  users: User[];
  allMilestonesForDropdown: { id: string; title: string }[];
  createUserFromAlias: (eventId: string) => void;
  loading: boolean;
};

function EventEditor({ event, draft, isMilestone, selectedEvents, toggleEvent, updateEventDraft, users, allMilestonesForDropdown, createUserFromAlias, loading }: EventEditorProps) {
  const isUpdate = event.review_action === "update";
  const badgeClasses = isUpdate
    ? "border-amber-300 bg-amber-50 text-amber-900"
    : "border-emerald-300 bg-emerald-50 text-emerald-900";

  return (
    <div className={`rounded-lg border p-4 ${isUpdate ? "border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20" : "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={selectedEvents.has(event.id)} onChange={() => toggleEvent(event.id)} disabled={event.applied} />
          {event.applied ? "Applied" : "Include"}
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full border px-2 py-1 font-medium ${badgeClasses}`}>
            {isUpdate ? "Update" : "New"} {isMilestone ? "milestone" : event.review_kind}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-700">{event.event_type}</span>
        </div>
      </div>

      {isUpdate && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          Updating: {event.target_title ?? "Unknown"}{event.target_status ? ` (${event.target_status})` : ""}
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <label className="text-sm font-medium">
          Title
          <input value={draft?.title ?? ""} onChange={(e) => updateEventDraft(event.id, { title: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied} />
        </label>
        <label className="text-sm font-medium">
          Status
          <select value={draft?.status ?? "open"} onChange={(e) => updateEventDraft(event.id, { status: e.target.value as ItemStatus })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="blocked">Blocked</option>
            <option value="complete">Complete</option>
          </select>
        </label>
        {!isMilestone && (
          <>
            <label className="text-sm font-medium">
              Priority
              <select value={draft?.priority ?? "medium"} onChange={(e) => updateEventDraft(event.id, { priority: e.target.value as TaskPriority })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Milestone
              <select value={draft?.milestone_id ?? ""} onChange={(e) => updateEventDraft(event.id, { milestone_id: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied}>
                <option value="">No milestone</option>
                {allMilestonesForDropdown.map((ms) => <option key={ms.id} value={ms.id}>{ms.title}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">
              Assignee alias
              <input value={draft?.assigned_to_alias ?? ""} onChange={(e) => updateEventDraft(event.id, { assigned_to_alias: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied} />
            </label>
            <label className="text-sm font-medium">
              Assign system user
              <select value={draft?.assigned_to_user_id ?? ""} onChange={(e) => updateEventDraft(event.id, { assigned_to_user_id: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied}>
                <option value="">Unassigned</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.display_name}</option>)}
              </select>
            </label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <label className="text-sm font-medium">
                New user phone
                <input value={draft?.new_user_phone ?? ""} onChange={(e) => updateEventDraft(event.id, { new_user_phone: e.target.value })} placeholder="+13125551212" className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied} />
              </label>
              <button type="button" onClick={() => createUserFromAlias(event.id)} disabled={event.applied || loading} className="self-end rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                Create User
              </button>
            </div>
            <label className="text-sm font-medium">
              Due date
              <input type="date" value={draft?.due_date ?? ""} onChange={(e) => updateEventDraft(event.id, { due_date: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied} />
            </label>
          </>
        )}
        {isMilestone && (
          <>
            <label className="text-sm font-medium">
              Budget
              <input type="number" value={draft?.budget ?? ""} onChange={(e) => updateEventDraft(event.id, { budget: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied} />
            </label>
            <label className="text-sm font-medium">
              Percent complete
              <input type="number" min="0" max="100" value={draft?.percent_complete ?? ""} onChange={(e) => updateEventDraft(event.id, { percent_complete: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied} />
            </label>
          </>
        )}
        <label className="text-sm font-medium lg:col-span-2">
          Description
          <textarea value={draft?.description ?? ""} onChange={(e) => updateEventDraft(event.id, { description: e.target.value })} rows={2} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied} />
        </label>
        <label className="text-sm font-medium lg:col-span-2">
          Notes
          <textarea value={draft?.notes ?? ""} onChange={(e) => updateEventDraft(event.id, { notes: e.target.value })} rows={2} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" disabled={event.applied} />
        </label>
      </div>
    </div>
  );
}
