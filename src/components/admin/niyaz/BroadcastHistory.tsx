"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";

// Broadcast history + delivery results for the Niyaz RSVP sends (audience_key='niyaz_rsvp'). Lists
// recent sends and expands each to its delivery rollup — sent / delivered / read / failed — from the
// existing broadcasts console endpoints. Statuses arrive asynchronously via the Meta delivery webhook,
// so a Refresh re-fetches.

type BroadcastRow = {
  id: string;
  template_code: string;
  status: string;
  total_recipients: number;
  count_sent: number;
  count_failed: number;
  est_cost_usd: number;
  started_at: string | null;
};

type Detail = { status_counts: Record<string, number>; failure_reasons: Record<string, number> };

// Meta status is the latest a message reached (sent → delivered → read), so present cumulative
// totals: a "read" message was also delivered and sent.
function rollup(sc: Record<string, number>) {
  const n = (k: string) => sc[k] ?? 0;
  const replied = n("replied");
  const read = n("read") + replied;
  const delivered = n("delivered") + read;
  const sent = n("sent") + delivered;
  return { sent, delivered, read, failed: n("failed"), queued: n("queued") + n("sending"), skipped: n("skipped") };
}

function when(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

const cell = "px-2 py-1 text-right tabular-nums";

export default function BroadcastHistory({ refreshKey, highlightId, audienceKey = "niyaz_rsvp", emptyLabel }: { refreshKey: number; highlightId?: string | null; audienceKey?: string; emptyLabel?: string }) {
  const [rows, setRows] = useState<BroadcastRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/admin/templates/broadcasts?audience_key=${encodeURIComponent(audienceKey)}`);
    if (res.ok) setRows(((await res.json()).broadcasts as BroadcastRow[]) ?? []);
  }, [audienceKey]);

  const openDetail = useCallback(async (id: string) => {
    setOpenId(id);
    setLoadingDetail(true);
    setDetail(null);
    const res = await apiFetch(`/api/admin/templates/broadcasts/${id}`);
    if (res.ok) setDetail((await res.json()) as Detail);
    setLoadingDetail(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Auto-open the just-sent broadcast's results.
  useEffect(() => {
    if (highlightId) void openDetail(highlightId);
  }, [highlightId, openDetail]);

  const r = detail ? rollup(detail.status_counts) : null;

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Broadcast history &amp; results</h2>
        <button type="button" onClick={() => { void load(); if (openId) void openDetail(openId); }} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
          Refresh
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{emptyLabel ?? "No Niyaz broadcasts yet."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-gray-400">
              <tr>
                <th className="px-2 py-1">Sent at</th>
                <th className="px-2 py-1">Template</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1 text-right">Total</th>
                <th className="px-2 py-1 text-right">Sent</th>
                <th className="px-2 py-1 text-right">Failed</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <Fragment key={b.id}>
                  <tr
                    onClick={() => (openId === b.id ? setOpenId(null) : void openDetail(b.id))}
                    className={`cursor-pointer border-t border-gray-100 dark:border-gray-800 ${b.id === highlightId ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                  >
                    <td className="px-2 py-1 text-xs text-gray-500">{when(b.started_at)}</td>
                    <td className="px-2 py-1 font-mono text-xs">{b.template_code}</td>
                    <td className="px-2 py-1 text-xs">{b.status}</td>
                    <td className={cell}>{b.total_recipients}</td>
                    <td className={cell}>{b.count_sent}</td>
                    <td className={`${cell} ${b.count_failed ? "text-red-600 dark:text-red-400" : ""}`}>{b.count_failed}</td>
                    <td className="px-2 py-1 text-right text-xs text-blue-600 dark:text-blue-400">{openId === b.id ? "Hide" : "Results"}</td>
                  </tr>
                  {openId === b.id && (
                    <tr className="border-t border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
                      <td colSpan={7} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                          {loadingDetail || !r ? (
                            <span className="text-xs text-gray-500">Loading results…</span>
                          ) : (
                            <>
                              <span><span className="text-gray-500">Sent</span> <b>{r.sent}</b></span>
                              <span><span className="text-gray-500">Delivered</span> <b>{r.delivered}</b></span>
                              <span><span className="text-gray-500">Read</span> <b>{r.read}</b></span>
                              <span className={r.failed ? "text-red-600 dark:text-red-400" : ""}><span className="text-gray-500">Failed</span> <b>{r.failed}</b></span>
                              {r.queued > 0 && <span><span className="text-gray-500">Queued</span> <b>{r.queued}</b></span>}
                              {r.skipped > 0 && <span><span className="text-gray-500">Skipped</span> <b>{r.skipped}</b></span>}
                              {detail && Object.keys(detail.failure_reasons).length > 0 && (
                                <span className="text-xs text-gray-500">· {Object.entries(detail.failure_reasons).map(([k, v]) => `${k}: ${v}`).join(", ")}</span>
                              )}
                            </>
                          )}
                          <a
                            href={`/api/admin/templates/broadcasts/${b.id}/recipients?format=csv`}
                            className="ml-auto text-xs font-medium text-blue-600 underline dark:text-blue-400"
                          >
                            Export CSV
                          </a>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
