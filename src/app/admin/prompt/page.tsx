"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { canManageKnowledge } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

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
  type RuleData = { name: string; label: string; text: string; default_text: string; is_default: boolean; updated_by: string | null; updated_at: string | null };
  const [alwaysOnRules, setAlwaysOnRules] = useState<RuleData[]>([]);
  const [dynamicContext, setDynamicContext] = useState<string[]>([]);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [ruleEdits, setRuleEdits] = useState<Record<string, string>>({});
  const [ruleSaving, setRuleSaving] = useState<string | null>(null);
  const [ruleSaved, setRuleSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [tab, setTab] = useState<"agent" | "quality">("agent");

  const [qualityPrompt, setQualityPrompt] = useState<PromptData | null>(null);
  const [qualityEditText, setQualityEditText] = useState("");
  const [qualitySaving, setQualitySaving] = useState(false);
  const [qualitySaved, setQualitySaved] = useState(false);
  const [cronLogs, setCronLogs] = useState<Array<{ id: string; started_at: string; completed_at: string | null; status: string; metadata: Record<string, unknown>; error_message: string | null }>>([]);
  const [runningQualityCron, setRunningQualityCron] = useState(false);
  const [qualityCronMsg, setQualityCronMsg] = useState<string | null>(null);

  async function loadData() {
    try {
      const [promptRes, toolsRes, rulesRes] = await Promise.all([
        apiFetch("/api/admin/prompts/agent_system"),
        apiFetch("/api/admin/prompts/tools"),
        apiFetch("/api/admin/prompts/rules"),
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

      if (rulesRes.ok) {
        const data = (await rulesRes.json()) as { rules: RuleData[]; dynamic: string[] };
        setAlwaysOnRules(data.rules ?? []);
        setDynamicContext(data.dynamic ?? []);
        const edits: Record<string, string> = {};
        for (const r of data.rules ?? []) edits[r.name] = r.text;
        setRuleEdits(edits);
      }

      await Promise.all([loadQualityPrompt(), loadCronLogs()]);
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

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }

    if (!canManageKnowledge(user)) {
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

  async function saveRule(name: string) {
    setRuleSaving(name);
    setRuleSaved(null);
    try {
      const res = await apiFetch("/api/admin/prompts/rules", {
        method: "PUT",
        body: JSON.stringify({ name, text: ruleEdits[name] ?? "" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { name: string; text: string; is_default: boolean };
        setAlwaysOnRules((prev) =>
          prev.map((r) => (r.name === name ? { ...r, text: data.text, is_default: data.is_default } : r)),
        );
        setRuleSaved(name);
      }
    } finally {
      setRuleSaving(null);
    }
  }

  function resetRule(name: string) {
    const rule = alwaysOnRules.find((r) => r.name === name);
    if (rule) {
      setRuleEdits((prev) => ({ ...prev, [name]: rule.default_text }));
      setRuleSaved(null);
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

      <section className="mt-8 rounded-lg border bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b px-6 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold">Always-on Rules</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              These rule blocks are appended to <strong>every</strong> system prompt, after the editable
              base prompt above. Click a rule to edit it.
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {alwaysOnRules.length} rules
          </span>
        </div>
        <div className="divide-y dark:divide-gray-800">
          {alwaysOnRules.map((rule, i) => (
            <div key={rule.name}>
              <button
                type="button"
                onClick={() => setExpandedRule(expandedRule === rule.name ? null : rule.name)}
                className="flex w-full items-center justify-between px-6 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <span className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{i + 1}</span>
                  <span className="text-sm font-medium">{rule.label}</span>
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">{rule.name}</code>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    rule.is_default
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  }`}>
                    {rule.is_default ? "Default" : "Customized"}
                  </span>
                </span>
                <span aria-label={expandedRule === rule.name ? "Collapse" : "Expand"}>{expandedRule === rule.name ? "▲" : "▼"}</span>
              </button>
              {expandedRule === rule.name && (
                <div className="border-t bg-gray-50 px-6 py-3 dark:border-gray-800 dark:bg-gray-950">
                  <textarea
                    value={ruleEdits[rule.name] ?? rule.text}
                    onChange={(e) => { setRuleEdits((prev) => ({ ...prev, [rule.name]: e.target.value })); setRuleSaved(null); }}
                    rows={Math.min(20, Math.max(6, (ruleEdits[rule.name] ?? rule.text).split("\n").length + 2))}
                    className="w-full rounded-md border px-3 py-2 font-mono text-xs leading-5 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {(ruleEdits[rule.name] ?? rule.text).length} chars
                      {rule.updated_at && !rule.is_default && (
                        <> &middot; Last updated: {new Date(rule.updated_at).toLocaleString()}</>
                      )}
                    </span>
                    <div className="flex items-center gap-3">
                      {ruleSaved === rule.name && <span className="text-sm text-green-700 dark:text-green-400">Saved</span>}
                      {!rule.is_default && (
                        <button
                          type="button"
                          onClick={() => resetRule(rule.name)}
                          className="rounded-md border px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300"
                        >
                          Reset to Default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void saveRule(rule.name)}
                        disabled={ruleSaving === rule.name || (ruleEdits[rule.name] ?? "").length > 15000}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {ruleSaving === rule.name ? "Saving..." : "Save Rule"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {dynamicContext.length > 0 && (
          <div className="border-t px-6 py-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            Plus per-message dynamic context: {dynamicContext.join(" · ")}.
          </div>
        )}
      </section>

      <section className="mt-8 rounded-lg border bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b px-6 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold">Function Calls</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Tools available to the WhatsApp agent, grouped by user access. Update via code.
            </p>
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
