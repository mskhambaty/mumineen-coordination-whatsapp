"use client";

import { useEffect, useState } from "react";
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
};

export default function PromptPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState<PromptData | null>(null);
  const [editText, setEditText] = useState("");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  async function loadData() {
    setLoading(true);
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
              Tools available to the WhatsApp agent. Update via code.
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {tools.length} tools &middot; Read-only
          </span>
        </div>

        <div className="divide-y dark:divide-gray-800">
          {tools.map((tool) => (
            <div key={tool.name}>
              <button
                type="button"
                onClick={() => toggleTool(tool.name)}
                className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{tool.name}</p>
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{tool.description}</p>
                </div>
                <span className="ml-4 text-gray-400">{expandedTool === tool.name ? "▲" : "▼"}</span>
              </button>

              {expandedTool === tool.name && (
                <div className="border-t bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-800/30">
                  <p className="mb-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                    Internal API: <span className="font-mono text-gray-700 dark:text-gray-300">{tool.internal_api}</span>
                  </p>

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
      </section>
    </main>
  );
}
