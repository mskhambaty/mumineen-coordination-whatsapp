"use client";

import { useEffect, useState } from "react";

// Admin-only quiz leaderboard + a "generate test link" button. Data comes from
// /api/admin/quiz/* which enforces the religious-monitor/admin gate server-side
// (a non-permitted caller gets 403 and sees the access message below).

type Row = { name: string | null; score: number; total: number; completed_at: string | null };
type Results = { rows: Row[]; summary: { sent: number; completed: number; avg_score: number | null; total: number } };

export default function AdminQuizPage() {
  const [data, setData] = useState<Results | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "forbidden" | "error">("loading");
  const [link, setLink] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/quiz/results")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Results) => {
        setData(d);
        setStatus("ok");
      })
      .catch((s) => setStatus(s === 403 || s === 401 ? "forbidden" : "error"));
  }
  useEffect(load, []);

  async function makeTestLink() {
    const r = await fetch("/api/admin/quiz/test-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (r.ok) setLink((await r.json()).link);
  }

  if (status === "loading") return <div className="p-8 text-gray-400">Loading…</div>;
  if (status === "forbidden") return <div className="p-8 text-gray-400">You don’t have access to the quiz dashboard.</div>;
  if (status === "error" || !data) return <div className="p-8 text-gray-400">Could not load results.</div>;

  const { rows, summary } = data;
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-1 text-2xl font-semibold">Ashara 1448H Quiz</h1>
      <p className="mb-6 text-sm text-gray-500">Admin-only leaderboard. Participants see only their own score.</p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Sent", summary.sent],
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
            <th className="py-2">Score</th>
            <th className="py-2">Completed</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-gray-400">
                No completed attempts yet.
              </td>
            </tr>
          )}
          {rows.map((r, n) => (
            <tr key={n} className="border-b border-gray-100">
              <td className="py-2">{n + 1}</td>
              <td className="py-2">{r.name ?? "—"}</td>
              <td className="py-2">
                {r.score} / {r.total}
              </td>
              <td className="py-2 text-gray-500">{r.completed_at ? new Date(r.completed_at).toLocaleString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
