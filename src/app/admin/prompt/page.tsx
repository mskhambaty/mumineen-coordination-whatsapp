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
    } finally {
      setLoading(false);
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

  const externalTools = tools.filter((tool) => tool.audience === "external");
  const internalTools = tools.filter((tool) => tool.audience === "internal");
  const inactiveTools = tools.filter((tool) => tool.availability !== "active");

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-gray-500">Loading...</p></div>;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
    </main>
  );
}
