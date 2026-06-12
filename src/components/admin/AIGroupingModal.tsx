"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";
import ClusterCard from "@/components/admin/ClusterCard";
import MatchCard from "@/components/admin/MatchCard";

// ---------------------------------------------------------------------------
// AIGroupingModal — full-screen modal showing AI-suggested issue clusters
// and matches to existing issues. Orchestrates ClusterCard + MatchCard.
// ---------------------------------------------------------------------------

type Escalation = {
  session_id: string;
  phone_e164: string;
  display_name: string | null;
  escalation_reason: string | null;
  escalated_at: string;
  last_message_preview: string | null;
};

type Cluster = {
  suggested_title: string;
  suggested_description: string;
  suggested_priority: "low" | "medium" | "high";
  suggested_department_id: string | null;
  suggested_department_name: string | null;
  category: string;
  reasoning: string;
  escalations: Escalation[];
};

type IssueMatch = {
  issue_id: string;
  issue_number: number;
  issue_title: string;
  issue_status: string;
  current_escalation_count: number;
  reasoning: string;
  escalations: Escalation[];
};

type SuggestionsResponse = {
  new_clusters: Cluster[];
  existing_issue_matches: IssueMatch[];
  meta: { ungrouped_count: number; analyzed_at: string };
};

type Department = { id: string; name: string };
type SupportMember = { id: string; display_name: string | null };
type LoadState = "loading" | "loaded" | "error" | "empty";

type AIGroupingModalProps = {
  onClose: () => void;
};

export default function AIGroupingModal({ onClose }: AIGroupingModalProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [supportMembers, setSupportMembers] = useState<SupportMember[]>([]);
  const [dismissedClusters, setDismissedClusters] = useState<Set<number>>(
    () => new Set(),
  );
  const [dismissedMatches, setDismissedMatches] = useState<Set<string>>(
    () => new Set(),
  );

  // ── Data fetching ────────────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async () => {
    setLoadState("loading");
    setErrorMsg(null);
    try {
      const [suggestionsRes, deptRes, membersRes] = await Promise.all([
        apiFetch("/api/admin/issues/suggestions"),
        apiFetch("/api/departments"),
        apiFetch("/api/admin/escalation-support"),
      ]);

      if (!suggestionsRes.ok) {
        const body = await suggestionsRes.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error ?? "Failed to load suggestions",
        );
      }

      const suggestionsData =
        (await suggestionsRes.json()) as SuggestionsResponse;
      const deptData = deptRes.ok
        ? ((await deptRes.json()) as Department[])
        : [];
      const membersBody = membersRes.ok
        ? ((await membersRes.json()) as { members?: Array<{ user: { id: string; display_name: string | null } }> })
        : {};
      const membersData = membersBody.members ?? [];

      setData(suggestionsData);
      setDepartments(deptData);
      setSupportMembers(
        membersData.map((m) => ({
          id: m.user.id,
          display_name: m.user.display_name,
        })),
      );

      const totalSuggestions =
        suggestionsData.new_clusters.length +
        suggestionsData.existing_issue_matches.length;
      setLoadState(totalSuggestions === 0 ? "empty" : "loaded");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Something went wrong",
      );
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void fetchSuggestions();
  }, [fetchSuggestions]);

  // ── Escape key handler ───────────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ── Action handlers ──────────────────────────────────────────────────────
  async function handleApply(fields: {
    title: string;
    description: string;
    priority: "low" | "medium" | "high";
    department_id: string | null;
    assigned_to: string | null;
    session_ids: string[];
  }) {
    const res = await apiFetch("/api/admin/issues/suggestions/apply", {
      method: "POST",
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as Record<string, string>).error ?? "Failed to create issue",
      );
    }
    const body = (await res.json()) as {
      issue: { issue_number: number };
      linked_count: number;
    };
    return { issue_number: body.issue.issue_number, linked_count: body.linked_count };
  }

  async function handleLink(issueId: string, sessionIds: string[]) {
    const res = await apiFetch(`/api/admin/issues/${issueId}/link-bulk`, {
      method: "POST",
      body: JSON.stringify({ session_ids: sessionIds }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as Record<string, string>).error ?? "Failed to link escalations",
      );
    }
    return (await res.json()) as { linked_count: number };
  }

  // ── Computed visibility ──────────────────────────────────────────────────
  const visibleClusters = (data?.new_clusters ?? []).filter(
    (_, idx) => !dismissedClusters.has(idx),
  );
  const visibleMatches = (data?.existing_issue_matches ?? []).filter(
    (match) => !dismissedMatches.has(match.issue_id),
  );
  const totalSuggestions = visibleClusters.length + visibleMatches.length;

  // ── Subtitle helper ──────────────────────────────────────────────────────
  function getSubtitle() {
    switch (loadState) {
      case "loading":
        return "Analyzing ungrouped escalations...";
      case "error":
        return "Failed to load suggestions";
      case "empty":
        return "No suggestions right now";
      case "loaded":
        return `${totalSuggestions} suggestion${totalSuggestions !== 1 ? "s" : ""} found`;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-4 border-b border-gray-700 bg-gray-950 px-6 py-4">
        {/* Purple sparkle icon */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-indigo-500">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white"
          >
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
            <path d="M18 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" opacity="0.6" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-100">
            AI Grouping Suggestions
          </h2>
          <p className="text-xs text-gray-400">{getSubtitle()}</p>
        </div>

        {loadState === "loaded" && (
          <span className="shrink-0 rounded-full border border-purple-700/50 bg-purple-900/40 px-2.5 py-0.5 text-[11px] font-medium text-purple-300">
            Analyzed just now
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Loading state */}
        {loadState === "loading" && (
          <div className="mx-auto max-w-2xl space-y-4">
            {/* Skeleton cards */}
            {[0, 1].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-gray-800 bg-gray-900 px-4 py-4"
              >
                <div className="mb-3 h-4 w-3/5 rounded bg-gray-800" />
                <div className="mb-2 h-3 w-2/5 rounded bg-gray-800" />
                <div className="h-3 w-4/5 rounded bg-gray-800" />
              </div>
            ))}
            {/* Spinner with text */}
            <div className="flex items-center justify-center gap-3 pt-4">
              <svg
                className="h-5 w-5 animate-spin text-purple-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <p className="text-sm text-gray-400">
                AI is analyzing escalation patterns and matching to existing issues...
              </p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {loadState === "empty" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/40 ring-1 ring-emerald-700/50">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-6 w-6 text-emerald-400"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-200">All clear</h3>
            <p className="mt-1 max-w-sm text-center text-sm text-gray-400">
              {data?.meta.ungrouped_count === 0
                ? "There are no ungrouped escalations right now. New escalations will appear here as they come in."
                : "AI could not identify any grouping patterns among the current ungrouped escalations. Try again later as more come in."}
            </p>
          </div>
        )}

        {/* Error state */}
        {loadState === "error" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-900/40 ring-1 ring-red-700/50">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-6 w-6 text-red-400"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-200">
              Failed to load suggestions
            </h3>
            <p className="mt-1 max-w-sm text-center text-sm text-red-400">
              {errorMsg}
            </p>
            <button
              type="button"
              onClick={() => void fetchSuggestions()}
              className="mt-4 rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gray-400 hover:text-gray-100"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Loaded state */}
        {loadState === "loaded" && data && (
          <div className="mx-auto max-w-2xl space-y-8">
            {/* New Clusters section */}
            {visibleClusters.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-200">
                    New Clusters
                  </h3>
                  <span className="rounded-full bg-purple-900/60 px-2 py-0.5 text-[11px] font-medium text-purple-300 ring-1 ring-purple-700/50">
                    {visibleClusters.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {data.new_clusters.map((cluster, idx) => {
                    if (dismissedClusters.has(idx)) return null;
                    return (
                      <ClusterCard
                        key={idx}
                        suggestedTitle={cluster.suggested_title}
                        suggestedDescription={cluster.suggested_description}
                        suggestedPriority={cluster.suggested_priority}
                        suggestedDepartmentId={cluster.suggested_department_id}
                        suggestedDepartmentName={cluster.suggested_department_name}
                        category={cluster.category}
                        reasoning={cluster.reasoning}
                        escalations={cluster.escalations}
                        departments={departments}
                        supportMembers={supportMembers}
                        onApply={handleApply}
                        onDismiss={() =>
                          setDismissedClusters(
                            (prev) => new Set(prev).add(idx),
                          )
                        }
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Divider between sections */}
            {visibleClusters.length > 0 && visibleMatches.length > 0 && (
              <hr className="border-gray-800" />
            )}

            {/* Link to Existing Issues section */}
            {visibleMatches.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-200">
                    Link to Existing Issues
                  </h3>
                  <span className="rounded-full bg-blue-900/60 px-2 py-0.5 text-[11px] font-medium text-blue-300 ring-1 ring-blue-700/50">
                    {visibleMatches.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {data.existing_issue_matches.map((match) => {
                    if (dismissedMatches.has(match.issue_id)) return null;
                    return (
                      <MatchCard
                        key={match.issue_id}
                        issueId={match.issue_id}
                        issueNumber={match.issue_number}
                        issueTitle={match.issue_title}
                        issueStatus={match.issue_status}
                        currentEscalationCount={match.current_escalation_count}
                        reasoning={match.reasoning}
                        escalations={match.escalations}
                        onLink={handleLink}
                        onDismiss={() =>
                          setDismissedMatches(
                            (prev) => new Set(prev).add(match.issue_id),
                          )
                        }
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* All dismissed state */}
            {totalSuggestions === 0 && (
              <div className="flex flex-col items-center justify-center py-12">
                <p className="text-sm text-gray-400">
                  All suggestions have been handled or dismissed.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 items-center justify-between border-t border-gray-700 bg-gray-950 px-6 py-3">
        <p className="text-xs text-gray-500">
          Only showing ungrouped escalations with pending/picked_up status
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gray-400 hover:text-gray-100"
        >
          Close
        </button>
      </footer>
      </div>
    </div>
  );
}
