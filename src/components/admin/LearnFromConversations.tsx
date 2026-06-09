"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";

type Suggestion = {
  id: string;
  question: string;
  suggested_answer: string;
  category: string | null;
  source_phone: string | null;
  confidence: number | null;
  status: string;
  created_at: string;
  department_id: string | null;
  department: { name: string } | null;
};

type DeptOption = { id: string; name: string };

// "Learn from Conversations": scan recent WhatsApp chats for questions the agent couldn't
// answer (a person had to step in), draft FAQ entries, and review/approve them into a
// department FAQ bucket. Self-contained so it can live on the Knowledge Gaps page alongside
// the agent-flagged gaps — both are "things the bot couldn't answer → publish an FAQ".
export default function LearnFromConversations() {
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);
  const [lookbackDays, setLookbackDays] = useState(7);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void loadSuggestions();
  }, []);

  async function loadSuggestions() {
    const [res, deptRes] = await Promise.all([
      apiFetch("/api/admin/knowledge/suggestions?status=pending"),
      apiFetch("/api/departments"),
    ]);
    if (res.ok) {
      const data = (await res.json()) as { suggestions: Suggestion[] };
      setSuggestions(data.suggestions ?? []);
    }
    if (deptRes.ok) {
      setDepartments((await deptRes.json()) as DeptOption[]);
    }
  }

  function reviewerName(): string | null {
    try {
      const raw = localStorage.getItem("admin_user");
      const u = raw ? (JSON.parse(raw) as { display_name?: string; email?: string }) : null;
      return u?.display_name ?? u?.email ?? null;
    } catch {
      return null;
    }
  }

  async function runAnalyze() {
    setAnalyzing(true);
    setAnalyzeMsg(null);
    try {
      const res = await apiFetch("/api/admin/knowledge/analyze", {
        method: "POST",
        body: JSON.stringify({ lookback_days: lookbackDays }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setAnalyzeMsg(
        `Scanned ${data.scanned} conversation(s) · ${data.created} new suggestion(s)` +
          (data.skippedDuplicates ? ` · ${data.skippedDuplicates} already queued` : "") +
          (data.skippedAlreadyAnswered ? ` · ${data.skippedAlreadyAnswered} already in a department FAQ` : ""),
      );
      await loadSuggestions();
    } catch (err) {
      setAnalyzeMsg(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  function editSuggestion(id: string, patch: Partial<Suggestion>) {
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function reviewSuggestion(id: string, action: "approve" | "reject") {
    const target = suggestions.find((s) => s.id === id);
    if (!target) return;
    if (action === "approve" && !target.department_id) {
      setAnalyzeMsg("Pick a department for that suggestion before approving.");
      return;
    }
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/admin/knowledge/suggestions/${id}`, {
        method: "POST",
        body: JSON.stringify({
          action,
          question: target.question,
          answer: target.suggested_answer,
          department_id: target.department_id,
          reviewed_by: reviewerName(),
        }),
      });
      if (res.ok) {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setAnalyzeMsg(data.error ?? "Could not update suggestion");
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Learn from Conversations</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Scan recent WhatsApp conversations for questions the AI couldn&apos;t answer (where a
            person had to step in), draft FAQ entries from them, and review below. Approved entries
            are added to the knowledge base so the agent answers them next time.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">
            Last
            <select
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
              className="mx-2 rounded-md border px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void runAnalyze()}
            disabled={analyzing}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {analyzing ? "Analyzing..." : "Analyze conversations"}
          </button>
        </div>
      </div>

      {analyzeMsg && (
        <p className="mt-3 text-sm font-medium text-blue-700 dark:text-blue-400">{analyzeMsg}</p>
      )}

      <div className="mt-5 space-y-4">
        {suggestions.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No suggestions waiting for review. Run an analysis to surface gaps.
          </p>
        ) : (
          suggestions.map((s) => (
            <div key={s.id} className="rounded-lg border p-4 dark:border-gray-800">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {s.category && (
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium dark:bg-gray-800">
                    {s.category}
                  </span>
                )}
                {typeof s.confidence === "number" && (
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-gray-800">
                    confidence {(s.confidence * 100).toFixed(0)}%
                  </span>
                )}
                {s.source_phone && <span>from {s.source_phone}</span>}
              </div>

              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Question
              </label>
              <input
                value={s.question}
                onChange={(e) => editSuggestion(s.id, { question: e.target.value })}
                className="mt-1 mb-3 block w-full rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />

              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Answer
              </label>
              <textarea
                value={s.suggested_answer}
                onChange={(e) => editSuggestion(s.id, { suggested_answer: e.target.value })}
                rows={3}
                className="mt-1 block w-full rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />

              <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Department FAQ bucket
              </label>
              <select
                value={s.department_id ?? ""}
                onChange={(e) => editSuggestion(s.id, { department_id: e.target.value || null })}
                className="mt-1 block w-full max-w-xs rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">Select a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>

              <div className="mt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => void reviewSuggestion(s.id, "reject")}
                  disabled={busyId === s.id}
                  className="rounded-md border px-4 py-2 text-sm text-gray-600 hover:text-red-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:text-red-400"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => void reviewSuggestion(s.id, "approve")}
                  disabled={busyId === s.id || !s.question.trim() || !s.suggested_answer.trim() || !s.department_id}
                  title={!s.department_id ? "Pick a department first" : undefined}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {busyId === s.id ? "Saving..." : "Approve → department FAQ"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
