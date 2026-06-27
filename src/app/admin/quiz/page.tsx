"use client";

import { useEffect, useState } from "react";

// Admin-only quiz dashboard: the shared public link + open/close switch, a "generate test link"
// button, and the leaderboard (score then fastest). Data comes from /api/admin/quiz/* which enforces
// the religious-monitor/admin gate server-side (a non-permitted caller gets 403 and sees the message
// below). ITS is shown here for admins only — never to participants.

type Row = { name: string | null; its_number: string | null; score: number; total: number; time_taken_seconds: number | null; completed_at: string | null };
type Results = { rows: Row[]; summary: { sent: number; completed: number; avg_score: number | null; total: number } };
type Share = { link: string; is_open: boolean };

const fmtTime = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export default function AdminQuizPage() {
  const [data, setData] = useState<Results | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "forbidden" | "error">("loading");
  const [share, setShare] = useState<Share | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    // Dev-only preview: `/admin/quiz?preview=1` renders the dashboard with sample data so it can be
    // viewed locally without an admin session or a database. Never available in production.
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview")) {
      setShare({ link: `${window.location.origin}/quiz/ashara-1448h-quiz`, is_open: true });
      setData({
        rows: [
          { name: "Husain bhai", its_number: "30000001", score: 14, total: 15, time_taken_seconds: 312, completed_at: new Date().toISOString() },
          { name: "Fatema ben", its_number: "30000002", score: 14, total: 15, time_taken_seconds: 388, completed_at: new Date().toISOString() },
          { name: "Yusuf bhai", its_number: "30000003", score: 11, total: 15, time_taken_seconds: 274, completed_at: new Date().toISOString() },
          { name: "Zainab ben", its_number: "30000004", score: 8, total: 15, time_taken_seconds: 410, completed_at: new Date().toISOString() },
        ],
        summary: { sent: 42, completed: 4, avg_score: 11.8, total: 15 },
      });
      setStatus("ok");
      return;
    }
    fetch("/api/admin/quiz/results")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Results) => {
        setData(d);
        setStatus("ok");
      })
      .catch((s) => setStatus(s === 403 || s === 401 ? "forbidden" : "error"));
    fetch("/api/admin/quiz/share")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setShare({ link: d.link, is_open: d.is_open }))
      .catch(() => {});
  }
  useEffect(load, []);

  async function makeTestLink() {
    const r = await fetch("/api/admin/quiz/test-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (r.ok) setLink((await r.json()).link);
  }

  async function toggleOpen() {
    if (!share) return;
    const r = await fetch("/api/admin/quiz/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_open: !share.is_open }) });
    if (r.ok) {
      const d = await r.json();
      setShare({ link: d.link, is_open: d.is_open });
    }
  }

  function copyLink() {
    if (!share) return;
    navigator.clipboard?.writeText(share.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (status === "loading") return <div className="p-8 text-gray-400">Loading…</div>;
  if (status === "forbidden") return <div className="p-8 text-gray-400">You don’t have access to the quiz dashboard.</div>;
  if (status === "error" || !data) return <div className="p-8 text-gray-400">Could not load results.</div>;

  const { rows, summary } = data;
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-1 text-2xl font-semibold">Ashara 1448H Quiz</h1>
      <p className="mb-6 text-sm text-gray-500">Admin-only leaderboard. Participants see only their own score. ITS is admin-only.</p>

      {/* Shared public link + open/close */}
      {share && (
        <div className="mb-6 rounded-lg border border-gray-200 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Shared quiz link</div>
            <span className={`rounded-full px-2 py-0.5 text-xs ${share.is_open ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600"}`}>
              {share.is_open ? "Open" : "Closed"}
            </span>
          </div>
          <p className="mb-3 break-all text-sm text-emerald-700">
            <a href={share.link}>{share.link}</a>
          </p>
          <div className="flex gap-2">
            <button onClick={copyLink} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button onClick={toggleOpen} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
              {share.is_open ? "Close quiz" : "Reopen quiz"}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">This is the single link everyone gets — takers enter their ITS + name. Send it via the WhatsApp template console to your chosen audience.</p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Attempts", summary.sent],
          ["Completed", summary.completed],
          ["Avg score", summary.avg_score ?? "—"],
          ["Out of", summary.total],
        ].map(([label, val]) => (
          <div key={label} className="rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-xl font-medium">{val}</div>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <button onClick={makeTestLink} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
          Generate test link
        </button>
        {link && (
          <p className="mt-2 break-all text-sm text-emerald-700">
            <a href={link}>{link}</a>
          </p>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2">#</th>
            <th className="py-2">Name</th>
            <th className="py-2">ITS</th>
            <th className="py-2">Score</th>
            <th className="py-2">Time</th>
            <th className="py-2">Completed</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-gray-400">
                No completed attempts yet.
              </td>
            </tr>
          )}
          {rows.map((r, n) => (
            <tr key={n} className="border-b border-gray-100">
              <td className="py-2">{n + 1}</td>
              <td className="py-2">{r.name ?? "—"}</td>
              <td className="py-2 text-gray-500">{r.its_number ?? "—"}</td>
              <td className="py-2">
                {r.score} / {r.total}
              </td>
              <td className="py-2 text-gray-500">{fmtTime(r.time_taken_seconds)}</td>
              <td className="py-2 text-gray-500">{r.completed_at ? new Date(r.completed_at).toLocaleString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
