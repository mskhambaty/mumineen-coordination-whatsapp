"use client";

import { useEffect, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Webinar = {
  id: string;
  title: string;
  youtube_url: string;
  description: string | null;
  created_at: string;
};

const SESSION_KEY = "webinars_verified";

function extractYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

// ─── ITS Gate ─────────────────────────────────────────────────────────────────

function ItsGate({ onVerified }: { onVerified: (name: string | null) => void }) {
  const [its, setIts] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/webinars/verify-its", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ its: its.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!json.ok) {
      setError(json.error ?? "Verification failed. Please try again.");
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name: json.name ?? null }));
    onVerified(json.name ?? null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Ashara Mubaraka 1448H</h1>
          <p className="mt-1 text-sm text-gray-500">Chicago Relay Center · Webinars</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-gray-900">Enter your ITS number</h2>
          <p className="mb-5 text-sm text-gray-500">
            Access is for registered mumineen only.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              value={its}
              onChange={(e) => { setIts(e.target.value.replace(/\D/g, "")); setError(null); }}
              placeholder="ITS number"
              required
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || its.length === 0}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function WebinarsPage() {
  const [verified, setVerified] = useState<boolean | null>(null); // null = loading check
  const [guestName, setGuestName] = useState<string | null>(null);
  const [webinars, setWebinars] = useState<Webinar[]>([]);
  const [webinarsLoading, setWebinarsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", youtube_url: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    // One-time client-only init from localStorage/sessionStorage — must run in an effect
    // (reading them during render would cause a hydration mismatch), so the synchronous
    // setState here is intentional.
    /* eslint-disable react-hooks/set-state-in-effect */
    const user = readAdminUser();
    const admin = isAdminOrLeadership(user);
    setIsAdmin(admin);

    // Admin/leadership bypass the ITS gate
    if (admin) {
      setVerified(true);
      return;
    }

    // Check sessionStorage for an existing verified session
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { name: string | null };
        setGuestName(parsed.name);
        setVerified(true);
        return;
      }
    } catch {
      // ignore
    }
    setVerified(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!verified) return;
    fetch("/api/webinars")
      .then((r) => r.json())
      .then((d) => setWebinars(d.webinars ?? []))
      .catch(() => null)
      .finally(() => setWebinarsLoading(false));
  }, [verified]);

  function handleVerified(name: string | null) {
    setGuestName(name);
    setVerified(true);
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
    setWebinars((prev) => [json.webinar, ...prev]);
    setForm({ title: "", youtube_url: "", description: "" });
    setShowAdd(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this webinar?")) return;
    setDeletingId(id);
    await apiFetch(`/api/webinars/${id}`, { method: "DELETE" });
    setWebinars((prev) => prev.filter((w) => w.id !== id));
    setDeletingId(null);
  }

  const inputCls =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  // Still checking session
  if (verified === null) return null;

  // Not verified — show gate
  if (!verified) return <ItsGate onVerified={handleVerified} />;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-5 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Ashara Mubaraka 1448H</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Chicago Relay Center · Webinars
              {guestName && !isAdmin && (
                <span className="ml-2 text-gray-400">— Marhaba, {guestName}</span>
              )}
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setShowAdd(true); setFormError(null); }}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <span className="text-base leading-none">+</span>
              Add Webinar
            </button>
          )}
        </div>
      </header>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Add Webinar</h2>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Title *</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g. Day 1 — Opening Session"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">YouTube URL *</label>
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
                <label className="mb-1 block text-xs font-medium text-gray-700">Description</label>
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
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
                >
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

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 py-10">
        {webinarsLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : webinars.length === 0 ? (
          <div className="py-20 text-center text-gray-400">
            <p className="text-lg font-medium">No webinars yet</p>
            <p className="mt-1 text-sm">Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {webinars.map((w) => {
              const videoId = extractYouTubeId(w.youtube_url);
              return (
                <div
                  key={w.id}
                  className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="relative aspect-video w-full bg-black">
                    {videoId ? (
                      <iframe
                        src={`https://www.youtube.com/embed/${videoId}`}
                        title={w.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="absolute inset-0 h-full w-full"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-gray-400">
                        Invalid YouTube URL
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="font-semibold text-gray-900">{w.title}</h2>
                    {w.description && (
                      <p className="mt-1 text-sm text-gray-500">{w.description}</p>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {new Date(w.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDelete(w.id)}
                          disabled={deletingId === w.id}
                          className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                        >
                          {deletingId === w.id ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </div>
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
