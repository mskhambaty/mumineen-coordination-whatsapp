"use client";

import { useEffect, useState } from "react";

import ContentBucketEditor from "@/components/admin/ContentBucketEditor";
import FaqBucketEditor from "@/components/admin/FaqBucketEditor";
import { apiFetch } from "@/lib/admin/client";

type Bucket = { department_id: string; department_name: string; content: string };
type Topic = { id: string; title: string; content: string; source_url?: string | null };

const PROMPTS = [
  { key: "agent_system", label: "Agent System Prompt" },
  { key: "conversation_quality", label: "Conversation Quality Prompt" },
];

// Quick-edit launcher used from the inbox: pick FAQ (a department bucket) or Prompt,
// then edit it inline. Reuses FaqBucketEditor for the FAQ path.
export default function QuickEditModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"choose" | "faq" | "religious" | "prompt">("choose");

  // FAQ path
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketDeptId, setBucketDeptId] = useState("");
  const [openBucket, setOpenBucket] = useState<Bucket | null>(null);

  // Religious content path
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [openTopic, setOpenTopic] = useState<Topic | null>(null);

  // Prompt path
  const [promptKey, setPromptKey] = useState("agent_system");
  const [promptText, setPromptText] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "faq") return;
    void (async () => {
      const res = await apiFetch("/api/admin/faq-buckets");
      if (res.ok) setBuckets(((await res.json()).buckets ?? []) as Bucket[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "religious") return;
    void (async () => {
      const res = await apiFetch("/api/admin/religious-topics");
      if (res.ok) setTopics(((await res.json()).topics ?? []) as Topic[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "prompt") return;
    void (async () => {
      setPromptLoading(true);
      setPromptSaved(false);
      const res = await apiFetch(`/api/admin/prompts/${promptKey}`);
      if (res.ok) setPromptText(((await res.json()) as { prompt_text: string }).prompt_text ?? "");
      setPromptLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, promptKey]);

  async function savePrompt() {
    setPromptSaving(true);
    setError(null);
    setPromptSaved(false);
    try {
      const res = await apiFetch(`/api/admin/prompts/${promptKey}`, {
        method: "PUT",
        body: JSON.stringify({ prompt_text: promptText }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save");
      setPromptSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setPromptSaving(false);
    }
  }

  // The FAQ editor is its own modal; render it on top once a department is chosen.
  if (openBucket) {
    return (
      <FaqBucketEditor
        departmentId={openBucket.department_id}
        departmentName={openBucket.department_name}
        initialContent={openBucket.content}
        onClose={() => { setOpenBucket(null); onClose(); }}
      />
    );
  }

  // Same for a religious topic block.
  if (openTopic) {
    return (
      <ContentBucketEditor
        title={openTopic.title}
        subtitle="Waaz Talaqi content — keep a respectful, sourced tone. Separate entries with a blank line. Saving re-indexes this for the agent."
        initialContent={openTopic.content}
        endpoint={`/api/admin/religious-topics/${openTopic.id}`}
        showSource
        initialSourceUrl={openTopic.source_url ?? null}
        onClose={() => { setOpenTopic(null); onClose(); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4 dark:border-gray-800">
          <h2 className="text-lg font-semibold">
            {mode === "choose"
              ? "Quick edit"
              : mode === "faq"
                ? "Edit a department FAQ"
                : mode === "religious"
                  ? "Edit Waaz Talaqi content"
                  : "Edit a prompt"}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
          )}

          {mode === "choose" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setMode("faq")}
                className="rounded-lg border p-5 text-left hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
              >
                <p className="font-medium">FAQ</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Edit a department&apos;s FAQ answers.</p>
              </button>
              <button
                type="button"
                onClick={() => setMode("religious")}
                className="rounded-lg border p-5 text-left hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
              >
                <p className="font-medium">Waaz Talaqi</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Edit a Vaaz / Iqtibasaat / Lisan topic block.</p>
              </button>
              <button
                type="button"
                onClick={() => setMode("prompt")}
                className="rounded-lg border p-5 text-left hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
              >
                <p className="font-medium">Prompt</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Edit the agent or quality prompt.</p>
              </button>
            </div>
          )}

          {mode === "faq" && (
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300">
                Department
                <select
                  value={bucketDeptId}
                  onChange={(e) => setBucketDeptId(e.target.value)}
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Select a department…</option>
                  {buckets.map((b) => (
                    <option key={b.department_id} value={b.department_id}>
                      {b.department_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={!bucketDeptId}
                  onClick={() => setOpenBucket(buckets.find((b) => b.department_id === bucketDeptId) ?? null)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Open editor
                </button>
              </div>
            </div>
          )}

          {mode === "religious" && (
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300">
                Topic
                <select
                  value={topicId}
                  onChange={(e) => setTopicId(e.target.value)}
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Select a topic…</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </label>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={!topicId}
                  onClick={() => setOpenTopic(topics.find((t) => t.id === topicId) ?? null)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Open editor
                </button>
              </div>
            </div>
          )}

          {mode === "prompt" && (
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300">
                Prompt
                <select
                  value={promptKey}
                  onChange={(e) => setPromptKey(e.target.value)}
                  className="mt-1 block w-full max-w-sm rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  {PROMPTS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </label>
              <textarea
                value={promptText}
                onChange={(e) => { setPromptText(e.target.value); setPromptSaved(false); }}
                rows={16}
                disabled={promptLoading}
                className="mt-3 w-full resize-y rounded-md border px-3 py-2 font-mono text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-5 py-3 dark:border-gray-800">
          {mode !== "choose" && (
            <button type="button" onClick={() => setMode("choose")} className="mr-auto text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              ← Back
            </button>
          )}
          {promptSaved && <span className="text-sm text-green-700 dark:text-green-400">Saved</span>}
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            Close
          </button>
          {mode === "prompt" && (
            <button
              type="button"
              onClick={() => void savePrompt()}
              disabled={promptSaving || promptLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {promptSaving ? "Saving…" : "Save prompt"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
