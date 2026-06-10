"use client";

import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/admin/client";

// ---------------------------------------------------------------------------
// CloseIssueModal — close an issue, optionally notify linked conversations
// ---------------------------------------------------------------------------

type Escalation = {
  link_id: string;
  phone_e164: string;
  display_name: string | null;
  escalation_stage: string;
};

type CloseIssueModalProps = {
  issue: { id: string; issue_number: number; title: string };
  escalations: Escalation[];
  onComplete: () => void;
  onCancel: () => void;
};

type Result = {
  messages_sent: number;
  messages_failed: number;
  conversations_resolved: number;
  failed_phones?: string[];
};

export default function CloseIssueModal({
  issue,
  escalations,
  onComplete,
  onCancel,
}: CloseIssueModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [resolveEscalations, setResolveEscalations] = useState(true);
  const [closeIssue, setCloseIssue] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [tipsOpen, setTipsOpen] = useState(true);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  const hasAction = closeIssue || resolveEscalations || message.trim().length > 0;
  const activeEscalations = escalations.filter(
    (e) => e.escalation_stage !== "resolved",
  );

  function getActionLabel() {
    const hasMsg = message.trim().length > 0;
    if (closeIssue && hasMsg) return "Close Issue & Notify";
    if (closeIssue) return "Close Issue";
    if (hasMsg && resolveEscalations) return "Resolve & Notify";
    if (hasMsg) return "Send Message";
    if (resolveEscalations) return "Resolve Escalations";
    return "Confirm";
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/issues/${issue.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          message: message.trim() || undefined,
          resolve_escalations: resolveEscalations,
          close_issue: closeIssue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to close issue");
      }

      const r: Result = {
        messages_sent: data.messages_sent ?? 0,
        messages_failed: data.messages_failed ?? 0,
        conversations_resolved: data.conversations_resolved ?? 0,
        failed_phones: data.failed_phones,
      };

      if (r.messages_failed > 0) {
        setResult(r);
      } else {
        onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onCancel();
      }}
    >
      <div className="relative mx-4 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" style={{ maxHeight: "85vh" }}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-6 py-4 dark:border-gray-700">
          <h2 className="text-base font-semibold">
            Close Issue{" "}
            <span className="font-mono text-purple-600 dark:text-purple-400">
              ISS-{issue.issue_number}
            </span>
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Tips */}
          {tipsOpen && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-950/30">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-2.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                  </svg>
                  <div className="space-y-1 text-xs text-blue-800 dark:text-blue-300">
                    <p className="font-medium">Tips for closing issues</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-blue-700 dark:text-blue-400">
                      <li>Write a resolution message to notify all linked conversations at once</li>
                      <li>Resolving escalations switches conversations back to AI handling</li>
                      <li>You can send a message without closing the issue if it&apos;s still in progress</li>
                    </ul>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTipsOpen(false)}
                  className="shrink-0 rounded p-0.5 text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/40 dark:hover:text-blue-300"
                  title="Dismiss tips"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            </div>
          )}

          {/* Result state — shown after partial failure */}
          {result ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Partially completed
                </p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Message sent to {result.messages_sent} conversation{result.messages_sent !== 1 ? "s" : ""}.
                  Failed to reach {result.messages_failed}:
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {(result.failed_phones ?? []).map((p) => {
                    const esc = escalations.find((e) => e.phone_e164 === p);
                    return (
                      <li key={p} className="text-xs text-amber-700 dark:text-amber-400">
                        {esc?.display_name ?? p}{" "}
                        <span className="text-amber-500">({p})</span>
                      </li>
                    );
                  })}
                </ul>
                {result.conversations_resolved > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    {result.conversations_resolved} escalation{result.conversations_resolved !== 1 ? "s" : ""} resolved.
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onComplete}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Resolution message */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Resolution message{" "}
                  <span className="font-normal text-gray-400 dark:text-gray-500">(optional)</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message to send to all linked conversations..."
                  rows={3}
                  maxLength={4096}
                  className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 shadow-sm transition-colors focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-purple-500 dark:focus:ring-purple-900/30"
                />
                {message.length > 0 && (
                  <p className={`mt-1 text-right text-xs ${message.length > 3900 ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-gray-500"}`}>
                    {message.length}/4096
                  </p>
                )}
              </div>

              {/* Recipients */}
              {escalations.length > 0 && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                    Linked conversations{" "}
                    <span className="text-gray-400 dark:text-gray-500">({escalations.length})</span>
                  </p>
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                    {escalations.map((esc) => {
                      const isResolved = esc.escalation_stage === "resolved";
                      return (
                        <div
                          key={esc.link_id}
                          className={`flex items-center gap-2.5 border-b border-gray-100 px-3 py-2 last:border-b-0 dark:border-gray-700/50 ${isResolved ? "opacity-50" : ""}`}
                        >
                          <div className={`h-2 w-2 shrink-0 rounded-full ${isResolved ? "bg-green-400" : "bg-amber-400"}`} />
                          <span className="flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                            {esc.display_name || esc.phone_e164}
                          </span>
                          {isResolved && (
                            <span className="shrink-0 text-[10px] font-medium text-gray-400 dark:text-gray-500">
                              already resolved
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {message.trim() && (
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Message will be sent to {escalations.length} conversation{escalations.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              )}

              {escalations.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No linked conversations. You can still close the issue.
                </p>
              )}

              {/* Toggles */}
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resolveEscalations}
                    onChange={(e) => setResolveEscalations(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Resolve linked escalations
                    </span>
                    {activeEscalations.length > 0 && (
                      <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                        ({activeEscalations.length} active)
                      </span>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Switches conversations back to AI handling
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={closeIssue}
                    onChange={(e) => setCloseIssue(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Close this issue
                    </span>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Sets issue status to resolved
                    </p>
                  </div>
                </label>
              </div>

              {/* Error */}
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer — hidden in result state */}
        {!result && (
          <div className="flex shrink-0 items-center justify-end gap-3 border-t px-6 py-4 dark:border-gray-700">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !hasAction}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-green-700 disabled:opacity-50 dark:bg-green-700 dark:hover:bg-green-600"
            >
              {submitting ? "Processing..." : getActionLabel()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
