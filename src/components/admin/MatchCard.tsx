"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// MatchCard — card for linking escalations to an *existing* issue.
// Blue accent, no review form — just a direct link action.
// ---------------------------------------------------------------------------

type Escalation = {
  session_id: string;
  phone_e164: string;
  display_name: string | null;
  escalation_reason: string | null;
  escalated_at: string;
  last_message_preview: string | null;
};

type MatchCardProps = {
  issueId: string;
  issueNumber: number;
  issueTitle: string;
  issueStatus: string;
  currentEscalationCount: number;
  reasoning: string;
  escalations: Escalation[];
  onLink: (issueId: string, sessionIds: string[]) => Promise<{ linked_count: number }>;
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

export default function MatchCard({
  issueId,
  issueNumber,
  issueTitle,
  issueStatus,
  currentEscalationCount,
  reasoning,
  escalations,
  onLink,
  onDismiss,
}: MatchCardProps) {
  const [state, setState] = useState<"collapsed" | "expanded" | "done">("collapsed");
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(escalations.map((e) => e.session_id)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkedCount, setLinkedCount] = useState(0);

  const issueBadge = `ISS-${issueNumber}`;
  const selectedCount = checked.size;

  function toggleCheck(sessionId: string) {
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

  async function handleLink() {
    if (checked.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await onLink(issueId, Array.from(checked));
      setLinkedCount(res.linked_count);
      setState("done");
    } catch (err) {
      setError((err as Error).message || "Failed to link");
    } finally {
      setSaving(false);
    }
  }

  // ── Done state ─────────────────────────────────────────────────────────────
  if (state === "done") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800/60 dark:bg-green-950/40 dark:text-green-300">
        <span className="text-base">✓</span>
        <span>
          Linked{" "}
          <span className="font-semibold">
            {linkedCount} escalation{linkedCount !== 1 ? "s" : ""}
          </span>{" "}
          to{" "}
          <span className="font-semibold text-blue-400">{issueBadge}</span>
        </span>
      </div>
    );
  }

  // ── Collapsed state ────────────────────────────────────────────────────────
  if (state === "collapsed") {
    return (
      <button
        type="button"
        onClick={() => setState("expanded")}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800/60"
      >
        {/* ISS-N badge */}
        <span className="shrink-0 rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-300 dark:bg-blue-900/60 dark:text-blue-300 dark:ring-blue-700/50">
          {issueBadge}
        </span>

        {/* Title */}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {issueTitle}
        </span>

        {/* Counts */}
        <span className="shrink-0 text-xs text-gray-500">
          {currentEscalationCount} linked · {escalations.length} new match
          {escalations.length !== 1 ? "es" : ""}
        </span>

        {/* Chevron */}
        <span className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden>
          ▸
        </span>
      </button>
    );
  }

  // ── Expanded state ─────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <button
        type="button"
        onClick={() => setState("collapsed")}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40"
      >
        <span className="shrink-0 rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-300 dark:bg-blue-900/60 dark:text-blue-300 dark:ring-blue-700/50">
          {issueBadge}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {issueTitle}
        </span>
        <span className="shrink-0 text-xs text-gray-500">
          Already has {currentEscalationCount} linked · {selectedCount} new selected
        </span>
        <span className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden>
          ▾
        </span>
      </button>

      <div className="border-t border-gray-200 px-4 pb-4 pt-3 space-y-3 dark:border-gray-700/60">
        {/* Escalation list */}
        <ul className="space-y-2">
          {escalations.map((esc) => {
            const isChecked = checked.has(esc.session_id);
            return (
              <li key={esc.session_id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                    isChecked
                      ? "border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50"
                      : "border-gray-200 bg-transparent opacity-40 dark:border-gray-700/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleCheck(esc.session_id)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-blue-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`text-sm font-medium text-gray-900 dark:text-gray-100 ${
                          !isChecked ? "line-through" : ""
                        }`}
                      >
                        {esc.display_name ?? "Unknown"}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500">
                        {relativeTime(esc.escalated_at)}
                      </span>
                    </div>
                    {esc.last_message_preview && (
                      <p
                        className={`mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400 ${
                          !isChecked ? "line-through" : ""
                        }`}
                      >
                        &ldquo;{esc.last_message_preview}&rdquo;
                      </p>
                    )}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        {/* AI reasoning box — blue-tinted */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-800/60 dark:bg-blue-950/40">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            <span className="mr-1.5">🔗</span>
            {reasoning}
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-400 dark:hover:text-gray-100"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => void handleLink()}
            disabled={saving || selectedCount === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Linking…" : `Link to ${issueBadge}`}
          </button>
        </div>
      </div>
    </div>
  );
}
