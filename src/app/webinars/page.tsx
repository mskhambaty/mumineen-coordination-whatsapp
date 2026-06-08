"use client";

import { useEffect, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Webinar = {
  id: string;
  seq: number;
  title: string;
  youtube_url: string;
  description: string | null;
  created_at: string;
};

function extractYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

export default function WebinarsAdminPage() {
  const [ready, setReady] = useState(false);
  const [webinars, setWebinars] = useState<Webinar[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", youtube_url: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedSeq, setCopiedSeq] = useState<number | null>(null);

  useEffect(() => {
    const user = readAdminUser();
    if (!isAdminOrLeadership(user)) {
      window.location.href = "/admin/login";
      return;
    }
    setReady(true);
    apiFetch("/api/webinars")
      .then((r) => r.json())
      .then((d) => setWebinars(d.webinars ?? []))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  function copyLink(seq: number) {
    const url = `${window.location.origin}/webinars/${seq}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedSeq(seq);
      setTimeout(() => setCopiedSeq(null), 2000);
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const res = await apiFetch("/api/webinars", {
      method: "POST",
      body: JSON.stringify({
        title: form.title,
        youtube_url: form.youtube_url,
        description: form.description || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(json.error ?? "Failed to add webinar");
      setSaving(false);
      return;
    }
    setWebinars((prev) => [...prev, json.webinar]);
    setForm({ title: "", youtube_url: "", description: "" });
    setShowAdd(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this webinar? It will no longer be accessible via its link.")) return;
    setDeletingId(id);
    await apiFetch(`/api/webinars/${id}`, { method: "DELETE" });
    setWebinars((prev) => prev.filter((w) => w.id !== id));
    setDeletingId(null);
  }

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-6 py-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Webinars</h1>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Manage embed links · share individual webinar URLs with mumineen</p>
          </div>
          <button
            type="button"
            onClick={() => { setShowAdd(true); setFormError(null); setForm({ title: "", youtube_url: "", description: "" }); }}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <span className="text-base leading-none">+</span>
            Add webinar
          </button>
        </div>
      </header>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">Add Webinar</h2>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Title *</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g. Day 1 — Opening Session"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">YouTube URL *</label>
                <input
                  required
                  type="url"
                  value={form.youtube_url}
                  onChange={(e) => setForm((f) => ({ ...f, youtube_url: e.target.value }))}
                  className={inputCls}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
                {form.youtube_url && !extractYouTubeId(form.youtube_url) && (
                  <p className="mt-1 text-xs text-red-500">Could not detect a YouTube video ID from this URL.</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className={inputCls}
                  placeholder="Optional short description"
                />
              </div>
              {formError && <p className="text-xs text-red-500">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !extractYouTubeId(form.youtube_url)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Adding…" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-4xl px-4 py-8">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : webinars.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-sm text-gray-400">No webinars added yet. Click "Add webinar" to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webinars.map((w) => {
              const videoId = extractYouTubeId(w.youtube_url);
              const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/webinars/${w.seq}`;
              return (
                <div key={w.id} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  {/* Thumbnail */}
                  <div className="h-16 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                    {videoId ? (
                      <img
                        src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                        alt={w.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-gray-400">No preview</div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-mono font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        #{w.seq}
                      </span>
                      <span className="truncate font-medium text-gray-900 dark:text-white">{w.title}</span>
                    </div>
                    {w.description && (
                      <p className="mt-0.5 truncate text-xs text-gray-400">{w.description}</p>
                    )}
                    <p className="mt-1 truncate font-mono text-[11px] text-gray-400">{shareUrl}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyLink(w.seq)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        copiedSeq === w.seq
                          ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                      }`}
                    >
                      {copiedSeq === w.seq ? "Copied!" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(w.id)}
                      disabled={deletingId === w.id}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/30"
                    >
                      {deletingId === w.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
