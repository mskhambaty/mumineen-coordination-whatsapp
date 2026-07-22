"use client";

import { useEffect, useRef, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import { WEBINAR_SHARE_PARAM, webinarShareUrl } from "@/lib/webinars/share";
import {
  extractYouTubeId,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "@/lib/webinars/youtube";

type Webinar = {
  id: string;
  seq: number;
  title: string;
  youtube_url: string;
  description: string | null;
};

const SESSION_KEY = "webinars_verified";

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

// ─── Share button ────────────────────────────────────────────────────────────
// Copies a deep link (/webinars?w=<seq>) to the clipboard. Used on each card and in
// the player modal. Stops propagation so tapping it never triggers the card's play.

function ShareButton({
  seq,
  className,
  label = "Share",
}: {
  seq: number;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = webinarShareUrl(window.location.origin, seq);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard unavailable (older browser / insecure context) — surface the link so
      // the user can copy it manually rather than failing silently.
      window.prompt("Copy this link:", url);
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy shareable link to this webinar"
      className={className}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
        {copied ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path strokeLinecap="round" d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" />
          </>
        )}
      </svg>
      {label && <span>{copied ? "Copied!" : label}</span>}
    </button>
  );
}

// ─── Video Card ──────────────────────────────────────────────────────────────

function VideoCard({ webinar, onPlay }: { webinar: Webinar; onPlay: () => void }) {
  const videoId = extractYouTubeId(webinar.youtube_url);
  const [thumbError, setThumbError] = useState(false);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition hover:border-white/20 hover:bg-white/[0.07]">
      {/* Share — absolutely positioned sibling so it isn't nested inside the play button */}
      <ShareButton
        seq={webinar.seq}
        label=""
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 backdrop-blur transition hover:bg-black/80 hover:text-white focus:opacity-100 group-hover:opacity-100"
      />
      <button
        type="button"
        onClick={onPlay}
        className="flex flex-col overflow-hidden text-left"
      >
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-teal-950 to-gray-950">
        {videoId && !thumbError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={youtubeThumbnailUrl(videoId)}
            alt=""
            onError={() => setThumbError(true)}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10 text-white/20">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        {/* Play badge */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-16 items-center justify-center rounded-xl bg-red-600 shadow-lg shadow-black/40 transition group-hover:scale-105">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1 p-4">
        <h3 className="text-sm font-semibold text-white">{webinar.title}</h3>
        {webinar.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-gray-400">
            {webinar.description}
          </p>
        )}
      </div>
      </button>
    </div>
  );
}

// ─── Player Modal ──────────────────────────────────────────────────────────────

function PlayerModal({ webinar, onClose }: { webinar: Webinar; onClose: () => void }) {
  const videoId = extractYouTubeId(webinar.youtube_url);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-lg text-white/80 backdrop-blur transition hover:bg-black/80 hover:text-white"
        >
          ✕
        </button>
        <div className="aspect-video w-full bg-black">
          {videoId ? (
            <iframe
              src={youtubeEmbedUrl(videoId)}
              title={webinar.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-500">Invalid video URL</p>
            </div>
          )}
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-white/5 px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{webinar.title}</p>
            {webinar.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-gray-400">{webinar.description}</p>
            )}
          </div>
          <ShareButton
            seq={webinar.seq}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-white/20 hover:text-white"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type GateState = "checking" | "gate" | "open";

export default function WebinarsPage() {
  const [gateState, setGateState] = useState<GateState>("checking");
  const [guestName, setGuestName] = useState<string | null>(null);
  const [isAdmin] = useState(() => isAdminOrLeadership(readAdminUser()));

  const [webinars, setWebinars] = useState<Webinar[]>([]);
  const [loadingWebinars, setLoadingWebinars] = useState(true);
  const [playing, setPlaying] = useState<Webinar | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Session / admin check ────────────────────────────────────────────────────
  useEffect(() => {
    if (isAdmin) {
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
  // isAdmin is stable (initialized once from localStorage, never changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch webinars once verified ─────────────────────────────────────────────
  // After loading, honor a ?w=<seq> deep link by auto-opening that webinar. Done here in
  // the async callback (not a separate effect) so it runs once and survives the ITS gate —
  // a shared link keeps its query param across verification.
  useEffect(() => {
    if (gateState !== "open") return;
    apiFetch("/api/webinars")
      .then((r) => r.json())
      .then((d) => {
        const list: Webinar[] = d.webinars ?? [];
        setWebinars(list);
        const seq = new URLSearchParams(window.location.search).get(WEBINAR_SHARE_PARAM);
        if (seq) {
          const match = list.find((w) => String(w.seq) === seq);
          if (match) setPlaying(match);
        }
      })
      .catch(() => null)
      .finally(() => setLoadingWebinars(false));
  }, [gateState]);

  // ── Open/close keep the URL shareable (address bar reflects the open webinar) ───
  function openWebinar(w: Webinar) {
    setPlaying(w);
    window.history.replaceState(null, "", `${window.location.pathname}?${WEBINAR_SHARE_PARAM}=${w.seq}`);
  }
  function closeWebinar() {
    setPlaying(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function handleVerified(name: string | null) {
    setGuestName(name);
    setGateState("open");
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this webinar? It will no longer be accessible.")) return;
    setDeletingId(id);
    await apiFetch(`/api/webinars/${id}`, { method: "DELETE" });
    setWebinars((prev) => prev.filter((w) => w.id !== id));
    setDeletingId(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (gateState === "checking") return null;
  if (gateState === "gate") return <ItsGate onVerified={handleVerified} />;

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

      {/* ── Grid ── */}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
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
        ) : (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {webinars.map((w) => (
              <VideoCard key={w.id} webinar={w} onPlay={() => openWebinar(w)} />
            ))}
          </div>
        )}
      </main>

      {/* ── Player modal ── */}
      {playing && <PlayerModal webinar={playing} onClose={closeWebinar} />}

      {/* ── Add modal ── */}
      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onAdded={(w) => setWebinars((prev) => [...prev, w])}
        />
      )}
    </div>
  );
}
