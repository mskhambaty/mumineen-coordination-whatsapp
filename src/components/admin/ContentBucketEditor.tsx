"use client";

import { useState } from "react";

const DEFAULT_PLACEHOLDER =
  "Q: When will the accommodation team contact me?\nA: After you submit the request form, the team reviews it and reaches out as arrangements are finalized.\n\nQ: ...\nA: ...";

// Reusable modal notepad for editing one editable knowledge "bucket" (a department FAQ
// bucket or a religious topic block). Saving PUTs to `endpoint`, which re-indexes the
// content into the relevant vector store. Used by the Vectorized Data page + inbox quick-edit.
export default function ContentBucketEditor({
  title,
  subtitle,
  placeholder,
  initialContent,
  endpoint,
  adminKey,
  onClose,
  onSaved,
}: {
  title: string;
  subtitle?: string;
  placeholder?: string;
  initialContent: string;
  endpoint: string;
  adminKey: string;
  onClose: () => void;
  onSaved?: (chunkCount: number) => void;
}) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      let updatedBy: string | null = null;
      try {
        const raw = localStorage.getItem("admin_user");
        const u = raw ? (JSON.parse(raw) as { display_name?: string; email?: string }) : null;
        updatedBy = u?.display_name ?? u?.email ?? null;
      } catch {
        updatedBy = null;
      }
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ content, updated_by: updatedBy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSaved(true);
      onSaved?.(data.chunk_count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {subtitle ?? "One Q&A per block (separate entries with a blank line). Saving re-indexes this for the agent."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setSaved(false); }}
            rows={18}
            placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
            className="w-full resize-y rounded-md border px-3 py-2 font-mono text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-5 py-3 dark:border-gray-800">
          {saved && <span className="text-sm text-green-700 dark:text-green-400">Saved &amp; indexed</span>}
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            Close
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & index"}
          </button>
        </div>
      </div>
    </div>
  );
}
