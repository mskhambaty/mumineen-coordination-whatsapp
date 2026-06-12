"use client";

import { useState } from "react";

import ClusterReviewForm from "@/components/admin/ClusterReviewForm";

// ---------------------------------------------------------------------------
// ClusterCard — 4-state card showing an AI-suggested issue cluster
// States: collapsed → expanded → reviewing → done
// ---------------------------------------------------------------------------

type Escalation = {
  session_id: string;
  phone_e164: string;
  display_name: string | null;
  escalation_reason: string | null;
  escalated_at: string;
  last_message_preview: string | null;
};

type Department = { id: string; name: string };
type SupportMember = { id: string; display_name: string | null };

type ClusterCardProps = {
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedPriority: "low" | "medium" | "high";
  suggestedDepartmentId: string | null;
  suggestedDepartmentName: string | null;
  category: string;
  reasoning: string;
  escalations: Escalation[];
  departments: Department[];
  supportMembers: SupportMember[];
  onApply: (fields: {
    title: string;
    description: string;
    priority: "low" | "medium" | "high";
    department_id: string | null;
    assigned_to: string | null;
    session_ids: string[];
  }) => Promise<{ issue_number: number; linked_count: number }>;
  onDismiss: () => void;
};

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function PriorityBadge({ priority }: { priority: "low" | "medium" | "high" }) {
  const classes =
    priority === "high"
      ? "bg-red-100 text-red-700 border border-red-300 dark:bg-red-900/60 dark:text-red-300 dark:border-red-700/60"
      : priority === "medium"
        ? "bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/60 dark:text-amber-300 dark:border-amber-700/60"
        : "bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/60 dark:text-blue-300 dark:border-blue-700/60";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${classes}`}>
      {priority}
    </span>
  );
}

export default function ClusterCard({
  suggestedTitle,
  suggestedDescription,
  suggestedPriority,
  suggestedDepartmentId,
  suggestedDepartmentName,
  category,
  reasoning,
  escalations,
  departments,
  supportMembers,
  onApply,
  onDismiss,
}: ClusterCardProps) {
  const [state, setState] = useState<"collapsed" | "expanded" | "reviewing" | "done">("collapsed");
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(escalations.map((e) => e.session_id)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ issue_number: number; linked_count: number } | null>(null);

  const checkedCount = checked.size;

  function toggleSession(sessionId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }

  async function handleConfirm(fields: {
    title: string;
    description: string;
    priority: "low" | "medium" | "high";
    department_id: string | null;
    assigned_to: string | null;
  }) {
    setSaving(true);
    setError(null);
    try {
      const res = await onApply({ ...fields, session_ids: Array.from(checked) });
      setResult(res);
      setState("done");
    } catch (err) {
      setError((err as Error).message || "Failed to create issue");
      setState("reviewing");
    } finally {
      setSaving(false);
    }
  }

  // ── Done state ─────────────────────────────────────────────────────────────
  if (state === "done" && result) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-600 dark:bg-emerald-900/40">
        {/* Checkmark icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5 shrink-0 text-emerald-400"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-emerald-800 dark:text-emerald-200">
            Created ISS-{result.issue_number}: {suggestedTitle}
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {result.linked_count} escalation{result.linked_count !== 1 ? "s" : ""} linked
            {suggestedDepartmentName ? ` · ${suggestedDepartmentName} dept notified` : ""}
          </p>
        </div>
      </div>
    );
  }

  // ── Collapsed state ─────────────────────────────────────────────────────────
  if (state === "collapsed") {
    return (
      <button
        type="button"
        onClick={() => setState("expanded")}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800/80"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{suggestedTitle}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {escalations.length} escalation{escalations.length !== 1 ? "s" : ""} · {category}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PriorityBadge priority={suggestedPriority} />
          <span className="text-gray-400 dark:text-gray-500">▸</span>
        </div>
      </button>
    );
  }

  // ── Expanded & Reviewing states ─────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <button
        type="button"
        onClick={() => setState("collapsed")}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{suggestedTitle}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {escalations.length} escalation{escalations.length !== 1 ? "s" : ""} · {category}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state === "reviewing" ? (
            <span className="rounded-full border border-purple-400 bg-purple-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-purple-700 dark:border-purple-700/60 dark:bg-purple-900/60 dark:text-purple-300">
              REVIEWING
            </span>
          ) : (
            <PriorityBadge priority={suggestedPriority} />
          )}
          <span className="text-gray-400 dark:text-gray-500">▾</span>
        </div>
      </button>

      {/* Body */}
      <div className="border-t border-gray-200 px-4 pb-4 pt-3 space-y-3 dark:border-gray-700/60">
        {/* Escalation list */}
        <div className="space-y-1">
          {escalations.map((esc) => {
            const isChecked = checked.has(esc.session_id);
            return (
              <label
                key={esc.session_id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/60 ${
                  isChecked ? "" : "opacity-40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleSession(esc.session_id)}
                  className="h-4 w-4 shrink-0 rounded border-gray-300 bg-white text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800"
                />
                <span
                  className={`min-w-[90px] shrink-0 text-sm font-medium text-gray-800 dark:text-gray-200 ${
                    isChecked ? "" : "line-through"
                  }`}
                >
                  {esc.display_name ?? esc.phone_e164}
                </span>
                {esc.last_message_preview && (
                  <span
                    className={`flex-1 truncate text-xs text-gray-500 dark:text-gray-400 ${
                      isChecked ? "" : "line-through"
                    }`}
                  >
                    &ldquo;{esc.last_message_preview}&rdquo;
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-gray-500">
                  {relativeTime(esc.escalated_at)}
                </span>
              </label>
            );
          })}
        </div>

        {/* AI reasoning */}
        <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2.5 dark:border-purple-800/60 dark:bg-purple-950/40">
          <p className="text-xs text-purple-700 dark:text-purple-300">
            <span className="mr-1.5">✨</span>
            {reasoning}
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        )}

        {/* Reviewing: ClusterReviewForm */}
        {state === "reviewing" && (
          <ClusterReviewForm
            suggestedTitle={suggestedTitle}
            suggestedDescription={suggestedDescription}
            suggestedPriority={suggestedPriority}
            suggestedDepartmentId={suggestedDepartmentId}
            departments={departments}
            supportMembers={supportMembers}
            selectedCount={checkedCount}
            onConfirm={handleConfirm}
            onCancel={() => setState("expanded")}
            saving={saving}
          />
        )}

        {/* Expanded: action buttons */}
        {state === "expanded" && (
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-400 dark:hover:text-gray-100"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => setState("reviewing")}
              disabled={checkedCount < 2}
              className="rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Create Issue &amp; Link All
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
