"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// ClusterReviewForm — inline review/edit form shown inside a ClusterCard
// when the user clicks "Create Issue & Link All". Lets the user tweak the
// AI-suggested issue fields before confirming.
// ---------------------------------------------------------------------------

type Department = { id: string; name: string };
type SupportMember = { id: string; display_name: string | null };

type ClusterReviewFormProps = {
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedPriority: "low" | "medium" | "high";
  suggestedDepartmentId: string | null;
  departments: Department[];
  supportMembers: SupportMember[];
  selectedCount: number;
  onConfirm: (fields: {
    title: string;
    description: string;
    priority: "low" | "medium" | "high";
    department_id: string | null;
    assigned_to: string | null;
  }) => void;
  onCancel: () => void;
  saving: boolean;
};

const PRIORITIES = ["low", "medium", "high"] as const;

function priorityActiveClass(p: "low" | "medium" | "high"): string {
  if (p === "low") return "bg-blue-600 text-white border-blue-600";
  if (p === "medium") return "bg-amber-500 text-white border-amber-500";
  return "bg-red-600 text-white border-red-600";
}

function priorityLabel(p: "low" | "medium" | "high"): string {
  if (p === "low") return "Low";
  if (p === "medium") return "Medium";
  return "High";
}

export default function ClusterReviewForm({
  suggestedTitle,
  suggestedDescription,
  suggestedPriority,
  suggestedDepartmentId,
  departments,
  supportMembers,
  selectedCount,
  onConfirm,
  onCancel,
  saving,
}: ClusterReviewFormProps) {
  const [title, setTitle] = useState(suggestedTitle);
  const [description, setDescription] = useState(suggestedDescription);
  const [priority, setPriority] = useState<"low" | "medium" | "high">(suggestedPriority);
  const [departmentId, setDepartmentId] = useState<string>(suggestedDepartmentId ?? "");
  const [assignedTo, setAssignedTo] = useState<string>("");

  function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onConfirm({
      title: trimmed,
      description,
      priority,
      department_id: departmentId || null,
      assigned_to: assignedTo || null,
    });
  }

  const canConfirm = title.trim().length > 0 && !saving;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 shadow-sm dark:border-gray-700 dark:bg-gray-950">
      {/* Form grid */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
        {/* Issue Title — full width */}
        <div className="lg:col-span-2">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Issue Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-900/40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            placeholder="Issue title…"
          />
        </div>

        {/* Description — full width */}
        <div className="lg:col-span-2">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Description{" "}
            <span className="normal-case tracking-normal text-gray-600">(AI-generated, editable)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={5000}
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-900/40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            placeholder="Describe the issue…"
          />
        </div>

        {/* Priority — pill toggle */}
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Priority
          </label>
          <div className="flex gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  priority === p
                    ? priorityActiveClass(p)
                    : "border-gray-300 bg-gray-100 text-gray-500 hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:bg-transparent dark:text-gray-400 dark:hover:border-gray-400 dark:hover:text-gray-300"
                }`}
              >
                {priorityLabel(p)}
              </button>
            ))}
          </div>
        </div>

        {/* Department */}
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Department
          </label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-900/40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Unassigned</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {/* Assign To */}
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Assign To
          </label>
          <select
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-900/40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Unassigned</option>
            {supportMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name ?? m.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-700">
        {/* Left: summary */}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Will create 1 issue and link{" "}
          <span className="font-semibold text-purple-600 dark:text-purple-400">
            {selectedCount} escalation{selectedCount !== 1 ? "s" : ""}
          </span>
        </p>

        {/* Right: actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-400 dark:hover:text-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canConfirm}
            className="rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Creating..." : "Confirm & Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
