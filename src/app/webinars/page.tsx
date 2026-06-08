"use client";

import { useEffect, useRef, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Webinar = {
  id: string;
  seq: number;
  title: string;
  youtube_url: string;
  description: string | null;
};

const SESSION_KEY = "webinars_verified";

function extractYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

// ─── ITS Gate ──────────────────────────────────────────────────────────────────

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-xl shadow-blue-950/60">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8 text-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Ashara Mubaraka 1448H</h1>
          <p className="mt-1.5 text-sm text-gray-400">Chicago Relay Center · Webinars</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-sm">
          <h2 className="mb-1 text-base font-semibold text-white">Enter your ITS number</h2>
          <p className="mb-5 text-sm text-gray-400">Access is for registered mumineen only.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              value={its}
              onChange={(e) => {
                setIts(e.target.value.replace(/\D/g, ""));
                setError(null);
              }}
              placeholder="ITS number"
              required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {error && (
              <p className="rounded-xl bg-red-950/50 px-3 py-2.5 text-xs text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || its.length === 0}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/50 transition hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Continue →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Add Webinar Modal ─────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function AddModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (w: Webinar) => void;
}) {
  const [form, setForm] = useState({ title: "", youtube_url: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoId = extractYouTubeId(form.youtube_url);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await apiFetch("/api/webinars", {
      method: "POST",
      body: JSON.stringify({
        title: form.title,
        youtube_url: form.youtube_url,
        description: form.description || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to add webinar");
      return;
    }
    onAdded(json.webinar);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
        <h2 className="mb-4 text-base font-semibold text-white">Add Webinar</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">Title *</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className={inputCls}
              placeholder="e.g. Day 1 — Opening Session"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">YouTube URL *</label>
            <input
              required
              type="url"
              value={form.youtube_url}
              onChange={(e) => setForm((f) => ({ ...f, youtube_url: e.target.value }))}
              className={inputCls}
              placeholder="https://www.youtube.com/watch?v=…"
            />
            {form.youtube_url && !videoId && (
              <p className="mt-1 text-xs text-red-400">
                Could not detect a YouTube video ID from this URL.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className={inputCls}
              placeholder="Optional short description"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-gray-400 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !videoId}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type GateState = "checking" | "gate" | "open";

export default function WebinarsPage() {
  const [gateState, setGateState] = useState<GateState>("checking");
  const [guestName, setGuestName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [webinars, setWebinars] = useState<Webinar[]>([]);
  const [loadingWebinars, setLoadingWebinars] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);

  const [showAdd, setShowAdd] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Refs so the postMessage handler can access latest values without stale closure
  const activeIdxRef = useRef(0);
  const webinarsRef = useRef<Webinar[]>([]);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);
  useEffect(() => {
    webinarsRef.current = webinars;
  }, [webinars]);

  // ── Session / admin check ────────────────────────────────────────────────────
  useEffect(() => {
    const user = readAdminUser();
    const admin = isAdminOrLeadership(user);
    setIsAdmin(admin);
    if (admin) {
      setGateState("open");
      return;
    }
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { name: string | null };
        setGuestName(parsed.name);
        setGateState("open");
        return;
      }
    } catch { /* ignore */ }
    setGateState("gate");
  }, []);

  // ── Fetch webinars once verified ─────────────────────────────────────────────
  useEffect(() => {
    if (gateState !== "open") return;
    apiFetch("/api/webinars")
      .then((r) => r.json())
      .then((d) => {
        setWebinars(d.webinars ?? []);
        setActiveIdx(0);
      })
      .catch(() => null)
      .finally(() => setLoadingWebinars(false));
  }, [gateState]);

  // ── Auto-advance on video end via YouTube postMessage ────────────────────────
  // YouTube embeds with ?enablejsapi=1 fire onStateChange messages.
  // State 0 = video ended; advance to next chip if one exists.
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (typeof e.data !== "string") return;
      try {
        const msg = JSON.parse(e.data) as { event?: string; info?: unknown };
        if (msg.event === "onStateChange" && msg.info === 0) {
          const cur = activeIdxRef.current;
          const wbs = webinarsRef.current;
          if (cur < wbs.length - 1) setActiveIdx(cur + 1);
        }
      } catch { /* ignore non-YT messages */ }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function handleVerified(name: string | null) {
    setGuestName(name);
    setGateState("open");
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this webinar? It will no longer be accessible.")) return;
    setDeletingId(id);
    await apiFetch(`/api/webinars/${id}`, { method: "DELETE" });
    setWebinars((prev) => {
      const next = prev.filter((w) => w.id !== id);
      setActiveIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
      return next;
    });
    setDeletingId(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (gateState === "checking") return null;
  if (gateState === "gate") return <ItsGate onVerified={handleVerified} />;

  const activeWebinar = webinars[activeIdx] ?? null;
  const activeVideoId = activeWebinar ? extractYouTubeId(activeWebinar.youtube_url) : null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-white">
      {/* ── Header ── */}
      <header className="flex flex-shrink-0 items-center justify-between border-b border-white/5 bg-black/50 px-5 py-3.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 shadow-lg shadow-blue-950/60">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div className="leading-none">
            <p className="text-sm font-semibold text-white">Ashara Mubaraka 1448H</p>
            <p className="mt-0.5 text-xs text-gray-500">Chicago Relay Center</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {guestName && (
            <span className="hidden text-sm text-gray-400 sm:block">
              Marhaba,{" "}
              <span className="font-medium text-gray-200">{guestName}</span>
            </span>
          )}
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setShowManage((s) => !s)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  showManage
                    ? "border-gray-500 bg-gray-700 text-gray-200"
                    : "border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-200"
                }`}
              >
                {showManage ? "Hide manage" : "Manage"}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <span className="text-sm leading-none">+</span>
                Add webinar
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Admin manage panel ── */}
      {isAdmin && showManage && (
        <div className="flex-shrink-0 border-b border-white/5 bg-gray-900/70 px-5 py-4 backdrop-blur-sm">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Webinar list
          </p>
          {webinars.length === 0 ? (
            <p className="text-xs text-gray-500">No webinars added yet.</p>
          ) : (
            <div className="space-y-1.5">
              {webinars.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex-shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
                      #{w.seq}
                    </span>
                    <span className="truncate text-sm text-gray-200">{w.title}</span>
                    {w.description && (
                      <span className="hidden truncate text-xs text-gray-500 sm:block">
                        — {w.description}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(w.id)}
                    disabled={deletingId === w.id}
                    className="ml-4 flex-shrink-0 rounded-lg px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-40"
                  >
                    {deletingId === w.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Chip row ── */}
      {!loadingWebinars && webinars.length > 0 && (
        <div className="flex-shrink-0 border-b border-white/5 bg-black/30 px-4 py-3">
          <div
            className="flex gap-2 overflow-x-auto pb-0.5"
            style={{ scrollbarWidth: "none" }}
          >
            {webinars.map((w, i) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                  i === activeIdx
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/60 ring-1 ring-blue-500/50"
                    : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                }`}
              >
                {w.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Video area ── */}
      <div className="relative min-h-0 flex-1 bg-black">
        {loadingWebinars ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : webinars.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/5">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10 text-gray-600">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div>
              <p className="text-base font-medium text-gray-400">No webinars available yet</p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  + Add first webinar
                </button>
              )}
            </div>
          </div>
        ) : activeVideoId ? (
          <iframe
            key={activeVideoId}
            src={`https://www.youtube.com/embed/${activeVideoId}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1`}
            title={activeWebinar?.title ?? "Webinar"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gray-500">Invalid video URL</p>
          </div>
        )}
      </div>

      {/* ── Description bar ── */}
      {!loadingWebinars && activeWebinar?.description && (
        <div className="flex-shrink-0 border-t border-white/5 bg-black/50 px-5 py-2.5">
          <p className="text-xs text-gray-400">
            <span className="mr-2 font-medium text-gray-300">{activeWebinar.title}</span>
            {activeWebinar.description}
          </p>
        </div>
      )}

      {/* ── Add modal ── */}
      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onAdded={(w) => {
            setWebinars((prev) => {
              const next = [...prev, w];
              setActiveIdx(next.length - 1);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
