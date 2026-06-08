"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { readAdminUser } from "@/lib/admin/client";

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
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Ashara Mubaraka 1448H</h1>
          <p className="mt-1 text-sm text-gray-400">Chicago Relay Center · Webinar</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-8">
          <h2 className="mb-1 text-base font-semibold text-white">Enter your ITS number</h2>
          <p className="mb-5 text-sm text-gray-400">Access is for registered mumineen only.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              value={its}
              onChange={(e) => { setIts(e.target.value.replace(/\D/g, "")); setError(null); }}
              placeholder="ITS number"
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {error && (
              <p className="rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-400">{error}</p>
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

export default function SingleWebinarPage() {
  const { seq } = useParams<{ seq: string }>();
  const [verified, setVerified] = useState<boolean | null>(null);
  const [guestName, setGuestName] = useState<string | null>(null);
  const [webinar, setWebinar] = useState<Webinar | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const user = readAdminUser();
    const isAdmin = isAdminOrLeadership(user);

    if (isAdmin) {
      setVerified(true);
      return;
    }
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { name: string | null };
        setGuestName(parsed.name);
        setVerified(true);
        return;
      }
    } catch { /* ignore */ }
    setVerified(false);
  }, []);

  useEffect(() => {
    if (!verified || !seq) return;
    fetch(`/api/webinars/${seq}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => { if (d?.webinar) setWebinar(d.webinar); })
      .catch(() => null);
  }, [verified, seq]);

  function handleVerified(name: string | null) {
    setGuestName(name);
    setVerified(true);
  }

  if (verified === null) return null;
  if (!verified) return <ItsGate onVerified={handleVerified} />;

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-center">
        <div>
          <p className="text-2xl font-bold text-white">Webinar not found</p>
          <p className="mt-2 text-sm text-gray-400">This link may no longer be active.</p>
        </div>
      </div>
    );
  }

  if (!webinar) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const videoId = extractYouTubeId(webinar.youtube_url);

  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      {/* Slim header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
        <div>
          <span className="text-sm font-semibold text-white">{webinar.title}</span>
          {webinar.description && (
            <span className="ml-2 text-xs text-gray-400">{webinar.description}</span>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Ashara Mubaraka 1448H</p>
          {guestName && <p className="text-xs text-gray-600">Marhaba, {guestName}</p>}
        </div>
      </header>

      {/* Full-page video */}
      <div className="relative flex-1">
        {videoId ? (
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0`}
            title={webinar.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Invalid video URL
          </div>
        )}
      </div>
    </div>
  );
}
