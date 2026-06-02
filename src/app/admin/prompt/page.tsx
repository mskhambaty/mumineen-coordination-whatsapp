"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { isAdminOrLeadership } from "@/lib/admin/access";

type PromptData = {
  prompt_key: string;
  prompt_text: string;
  is_default: boolean;
  default_text: string;
  updated_by: string | null;
  updated_at: string | null;
};

type ToolParam = {
  type?: string;
  description?: string;
  enum?: string[];
};

type ToolInfo = {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties?: Record<string, ToolParam>;
    required?: string[];
  };
  internal_api: string;
  audience: "external" | "internal";
  availability: "active" | "setup_no_data" | "not_connected";
  status_label: string;
  status_note: string;
};

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

function getStatusClasses(availability: ToolInfo["availability"]) {
  switch (availability) {
    case "active":
      return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
    case "setup_no_data":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    case "not_connected":
      return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  }
}

function ToolGroup({
  title,
  description,
  tools,
  expandedTool,
  onToggleTool,
  renderAction,
}: {
  title: string;
  description: string;
  tools: ToolInfo[];
  expandedTool: string | null;
  onToggleTool: (name: string) => void;
  renderAction?: (tool: ToolInfo) => ReactNode;
}) {
  const inactiveCount = tools.filter((tool) => tool.availability !== "active").length;

  return (
    <div>
      <div className="border-b bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-800/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
          </div>
          <span className="w-fit rounded-full bg-white px-3 py-1 text-xs text-gray-600 ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:ring-gray-700">
            {tools.length} tools
            {inactiveCount > 0 && <> &middot; {inactiveCount} setup only/not connected</>}
          </span>
        </div>
      </div>

      <div className="divide-y dark:divide-gray-800">
        {tools.map((tool) => (
          <div key={tool.name}>
            <div className="flex w-full items-start justify-between gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <button
                type="button"
                onClick={() => onToggleTool(tool.name)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{tool.name}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(tool.availability)}`}>
                    {tool.status_label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{tool.description}</p>
                {tool.availability !== "active" && (
                  <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                    {tool.status_note}
                  </p>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-3">
                {renderAction?.(tool)}
                <button
                  type="button"
                  onClick={() => onToggleTool(tool.name)}
                  className="text-gray-400"
                  aria-label={expandedTool === tool.name ? "Collapse" : "Expand"}
                >
                  {expandedTool === tool.name ? "▲" : "▼"}
                </button>
              </div>
            </div>

            {expandedTool === tool.name && (
              <div className="border-t bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-800/30">
                <div className="mb-4 grid gap-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-[120px_1fr]">
                  <span className="font-medium uppercase tracking-wide">Internal API</span>
                  <span className="font-mono text-gray-700 dark:text-gray-300">{tool.internal_api}</span>
                  <span className="font-medium uppercase tracking-wide">Status</span>
                  <span className="text-gray-700 dark:text-gray-300">{tool.status_note}</span>
                </div>

                {tool.parameters.properties && Object.keys(tool.parameters.properties).length > 0 ? (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                        <th className="pb-2 pr-4">Parameter</th>
                        <th className="pb-2 pr-4">Type</th>
                        <th className="pb-2 pr-4">Required</th>
                        <th className="pb-2">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700">
                      {Object.entries(tool.parameters.properties).map(([paramName, param]) => (
                        <tr key={paramName}>
                          <td className="py-2 pr-4 font-mono text-gray-900 dark:text-gray-200">{paramName}</td>
                          <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                            {param.type}
                            {param.enum && <span className="ml-1 text-xs">({param.enum.join(" | ")})</span>}
                          </td>
                          <td className="py-2 pr-4">
                            {tool.parameters.required?.includes(paramName)
                              ? <span className="text-red-600 dark:text-red-400">Yes</span>
                              : <span className="text-gray-400">No</span>}
                          </td>
                          <td className="py-2 text-gray-600 dark:text-gray-400">{param.description ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No parameters.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PromptPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState<PromptData | null>(null);
  const [editText, setEditText] = useState("");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);

  const [tab, setTab] = useState<"agent" | "quality">("agent");

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);
  const [lookbackDays, setLookbackDays] = useState(7);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [qualityPrompt, setQualityPrompt] = useState<PromptData | null>(null);
  const [qualityEditText, setQualityEditText] = useState("");
  const [qualitySaving, setQualitySaving] = useState(false);
  const [qualitySaved, setQualitySaved] = useState(false);
  const [cronLogs, setCronLogs] = useState<Array<{ id: string; started_at: string; completed_at: string | null; status: string; metadata: Record<string, unknown>; error_message: string | null }>>([]);
  const [runningQualityCron, setRunningQualityCron] = useState(false);
  const [qualityCronMsg, setQualityCronMsg] = useState<string | null>(null);

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  async function apiFetch(path: string, init?: RequestInit) {
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
        ...(init?.headers ?? {}),
      },
    });
  }

  async function loadData() {
    try {
      const [promptRes, toolsRes] = await Promise.all([
        apiFetch("/api/admin/prompts/agent_system"),
        apiFetch("/api/admin/prompts/tools"),
      ]);

      if (promptRes.ok) {
        const data = (await promptRes.json()) as PromptData;
        setPrompt(data);
        setEditText(data.prompt_text);
      }

      if (toolsRes.ok) {
        const data = (await toolsRes.json()) as { tools: ToolInfo[] };
        setTools(data.tools);
      }

      await Promise.all([loadSuggestions(), loadQualityPrompt(), loadCronLogs()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadQualityPrompt() {
    const res = await apiFetch("/api/admin/prompts/conversation_quality");
    if (res.ok) {
      const data = (await res.json()) as PromptData;
      setQualityPrompt(data);
      setQualityEditText(data.prompt_text);
    }
  }

  async function loadCronLogs() {
    const res = await apiFetch("/api/admin/cron-logs?job_key=conversation_quality&limit=20");
    if (res.ok) {
      const data = (await res.json()) as { logs: typeof cronLogs };
      setCronLogs(data.logs ?? []);
    }
  }

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

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }

    const userRaw = localStorage.getItem("admin_user");
    const user = userRaw ? JSON.parse(userRaw) as { role?: string; global_role?: string } : null;
    if (!isAdminOrLeadership(user)) {
      router.push("/admin/tasks");
      return;
    }

    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function savePrompt() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await apiFetch("/api/admin/prompts/agent_system", {
        method: "PUT",
        body: JSON.stringify({ prompt_text: editText }),
      });
      if (res.ok) {
        const data = (await res.json()) as { prompt_text: string; updated_at: string };
        setPrompt((prev) => prev ? { ...prev, prompt_text: data.prompt_text, is_default: false, updated_at: data.updated_at } : prev);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  }

  function resetToDefault() {
    if (!prompt) return;
    setEditText(prompt.default_text);
    setSaved(false);
  }

  function toggleTool(name: string) {
    setExpandedTool((prev) => (prev === name ? null : name));
  }

  async function runScrape() {
    setScraping(true);
    setScrapeResult(null);
    try {
      const res = await apiFetch("/api/admin/scrape", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Scrape failed");
      const s = (data.stats ?? {}) as { discoveredPages?: number; embeddedChunks?: number; insertedChunks?: number };
      setScrapeResult(`Done · ${s.discoveredPages ?? 0} pages · ${s.embeddedChunks ?? 0} new chunks embedded · ${s.insertedChunks ?? 0} stored`);
    } catch (err) {
      setScrapeResult(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setScraping(false);
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

  async function saveQualityPrompt() {
    setQualitySaving(true);
    setQualitySaved(false);
    try {
      const res = await apiFetch("/api/admin/prompts/conversation_quality", {
        method: "PUT",
        body: JSON.stringify({ prompt_text: qualityEditText }),
      });
      if (res.ok) {
        const data = (await res.json()) as { prompt_text: string; updated_at: string };
        setQualityPrompt((prev) => prev ? { ...prev, prompt_text: data.prompt_text, is_default: false, updated_at: data.updated_at } : prev);
        setQualitySaved(true);
      }
    } finally {
      setQualitySaving(false);
    }
  }

  function resetQualityToDefault() {
    if (!qualityPrompt) return;
    setQualityEditText(qualityPrompt.default_text);
    setQualitySaved(false);
  }

  async function runQualityCron() {
    setRunningQualityCron(true);
    setQualityCronMsg(null);
    try {
      const res = await apiFetch("/api/cron/conversation-quality", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Cron failed");
      setQualityCronMsg(
        `Analyzed ${data.analyzed ?? 0} conversations · ${data.good ?? 0} good · ${data.poor ?? 0} poor` +
          (data.skipped ? ` · ${data.skipped} already up to date` : ""),
      );
      await loadCronLogs();
    } catch (err) {
      setQualityCronMsg(err instanceof Error ? err.message : "Cron failed");
    } finally {
      setRunningQualityCron(false);
    }
  }

  const externalTools = tools.filter((tool) => tool.audience === "external");
  const internalTools = tools.filter((tool) => tool.audience === "internal");
  const inactiveTools = tools.filter((tool) => tool.availability !== "active");

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-gray-500">Loading...</p></div>;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex gap-2 text-sm font-medium">
        <button
          onClick={() => setTab("agent")}
          className={`rounded-md px-4 py-2 ${tab === "agent" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"}`}
        >
          Agent System Prompt
        </button>
        <button
          onClick={() => setTab("quality")}
          className={`rounded-md px-4 py-2 ${tab === "quality" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"}`}
        >
          Conversation Quality Analysis
        </button>
      </div>

      {tab === "agent" && (<>
      <section className="rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Agent System Prompt</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This prompt is sent to OpenAI for every WhatsApp conversation.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${
            prompt?.is_default
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          }`}>
            {prompt?.is_default ? "Default" : "Customized"}
          </span>
        </div>

        <textarea
          value={editText}
          onChange={(e) => { setEditText(e.target.value); setSaved(false); }}
          rows={20}
          className="w-full rounded-md border px-4 py-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {editText.length} / 10000 characters
            {prompt?.updated_at && !prompt.is_default && (
              <> &middot; Last updated: {new Date(prompt.updated_at).toLocaleString()}</>
            )}
          </span>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-700 dark:text-green-400">Saved</span>}
            {!prompt?.is_default && (
              <button
                type="button"
                onClick={resetToDefault}
                className="rounded-md border px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300"
              >
                Reset to Default
              </button>
            )}
            <button
              type="button"
              onClick={savePrompt}
              disabled={saving || editText.length > 10000}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Prompt"}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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

      <section className="mt-8 rounded-lg border bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b px-6 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold">Function Calls</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Tools available to the WhatsApp agent, grouped by user access. Update via code.
            </p>
            {scrapeResult && (
              <p className="mt-1 text-xs font-medium text-blue-700 dark:text-blue-400">{scrapeResult}</p>
            )}
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {tools.length} tools &middot; {inactiveTools.length} setup only/not connected &middot; Read-only
          </span>
        </div>

        <ToolGroup
          title="External Users"
          description="Public function calls available to normal WhatsApp users with no internal permissions."
          tools={externalTools}
          expandedTool={expandedTool}
          onToggleTool={toggleTool}
          renderAction={(tool) =>
            tool.name === "get_site_content_faq" ? (
              <button
                type="button"
                onClick={() => void runScrape()}
                disabled={scraping}
                title="Re-scrape the official site now and refresh the indexed content (independent of the daily cron)"
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {scraping ? "Scraping..." : "Run scrape"}
              </button>
            ) : null
          }
        />

        <ToolGroup
          title="Internal Users"
          description="Permission-protected function calls for committee members, department users, PM/HOD users, and leadership/admin."
          tools={internalTools}
          expandedTool={expandedTool}
          onToggleTool={toggleTool}
        />
      </section>
      </>)}

      {tab === "quality" && (<>
      <section className="rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Conversation Quality Prompt</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This prompt is used by the hourly cron job to evaluate whether the AI bot handled each conversation well.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${
            qualityPrompt?.is_default
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          }`}>
            {qualityPrompt?.is_default ? "Default" : "Customized"}
          </span>
        </div>

        <textarea
          value={qualityEditText}
          onChange={(e) => { setQualityEditText(e.target.value); setQualitySaved(false); }}
          rows={16}
          className="w-full rounded-md border px-4 py-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {qualityEditText.length} / 10000 characters
            {qualityPrompt?.updated_at && !qualityPrompt.is_default && (
              <> &middot; Last updated: {new Date(qualityPrompt.updated_at).toLocaleString()}</>
            )}
          </span>
          <div className="flex items-center gap-3">
            {qualitySaved && <span className="text-sm text-green-700 dark:text-green-400">Saved</span>}
            {!qualityPrompt?.is_default && (
              <button
                type="button"
                onClick={resetQualityToDefault}
                className="rounded-md border px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300"
              >
                Reset to Default
              </button>
            )}
            <button
              type="button"
              onClick={saveQualityPrompt}
              disabled={qualitySaving || qualityEditText.length > 10000}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {qualitySaving ? "Saving..." : "Save Prompt"}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Quality Analysis Cron</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Runs hourly to evaluate updated conversations. You can also trigger it manually.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runQualityCron()}
            disabled={runningQualityCron}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {runningQualityCron ? "Running..." : "Run Now"}
          </button>
        </div>

        {qualityCronMsg && (
          <p className="mt-3 text-sm font-medium text-blue-700 dark:text-blue-400">{qualityCronMsg}</p>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Started</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Analyzed</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Good</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Poor</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {cronLogs.map((log) => {
                const meta = log.metadata as Record<string, number>;
                return (
                  <tr key={log.id}>
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{new Date(log.started_at).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        log.status === "success" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : log.status === "failure" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{meta.conversations_analyzed ?? "—"}</td>
                    <td className="px-4 py-2 text-green-700 dark:text-green-400">{meta.good ?? "—"}</td>
                    <td className="px-4 py-2 text-red-700 dark:text-red-400">{meta.poor ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{log.error_message ?? "—"}</td>
                  </tr>
                );
              })}
              {cronLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No cron runs yet. Click &quot;Run Now&quot; to trigger the first analysis.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      </>)}
    </main>
  );
}
