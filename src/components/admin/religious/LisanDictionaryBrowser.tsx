"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";

type Row = { id: number; transliteration: string | null; lisan: string | null; meaning: string | null; example: string | null };
type Field = "all" | "word" | "meaning";
const PAGE_SIZE = 25;

// Browse / search the indexed Lisan ud Dawat dictionary, with per-field copy buttons (so a monitor
// can paste a correct spelling/meaning into the Inbox) and inline edit / delete. Read + edit go
// through /api/admin/lisan-words (list / PATCH / DELETE).
export default function LisanDictionaryBrowser() {
  const [q, setQ] = useState("");
  const [field, setField] = useState<Field>("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ list: "1", q, field, page: String(page), pageSize: String(PAGE_SIZE) });
      const res = await apiFetch(`/api/admin/lisan-words?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows((data.rows ?? []) as Row[]);
      setTotal((data.total ?? 0) as number);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [q, field, page]);

  // Debounce search/field changes; reset to page 1 when the query changes.
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function copy(label: string, text: string | null) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
    } catch {
      setError("Couldn't copy to clipboard");
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/lisan-words", {
        method: "PATCH",
        body: JSON.stringify(editing),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Edit failed");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Row) {
    if (!confirm(`Delete “${row.transliteration || row.lisan}” from the dictionary?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/lisan-words?id=${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Delete failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const inputClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100";

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-lg font-semibold">Browse dictionary</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Search the {total.toLocaleString()} indexed words. Copy a word or meaning to paste into the Inbox, or
        fix a wrong entry with Edit / Delete.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search word or meaning…"
          className={`min-w-0 flex-1 ${inputClass}`}
        />
        <select value={field} onChange={(e) => { setField(e.target.value as Field); setPage(1); }} className={inputClass}>
          <option value="all">Word + meaning</option>
          <option value="word">Word only</option>
          <option value="meaning">Meaning only</option>
        </select>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map((r) => (
          <li key={r.id} className="py-3">
            {editing?.id === r.id ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input value={editing.transliteration ?? ""} onChange={(e) => setEditing({ ...editing, transliteration: e.target.value })} placeholder="Transliteration" className={inputClass} />
                <input value={editing.lisan ?? ""} onChange={(e) => setEditing({ ...editing, lisan: e.target.value })} placeholder="Lisan" dir="rtl" className={inputClass} />
                <input value={editing.meaning ?? ""} onChange={(e) => setEditing({ ...editing, meaning: e.target.value })} placeholder="Meaning" className={inputClass} />
                <input value={editing.example ?? ""} onChange={(e) => setEditing({ ...editing, example: e.target.value })} placeholder="Example" className={inputClass} />
                <div className="flex gap-2 sm:col-span-2">
                  <button onClick={saveEdit} disabled={busy} className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
                  <button onClick={() => setEditing(null)} className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{r.transliteration ?? "—"}</span>
                    {r.lisan && <span dir="rtl" className="text-gray-700 dark:text-gray-300">{r.lisan}</span>}
                  </div>
                  <p className="mt-0.5 text-gray-600 dark:text-gray-400">{r.meaning ?? "—"}</p>
                  {r.example && <p className="mt-0.5 text-xs text-gray-400">e.g. {r.example}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {r.lisan && <button onClick={() => copy(`lisan-${r.id}`, r.lisan)} className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{copied === `lisan-${r.id}` ? "Copied" : "Copy word"}</button>}
                  {r.meaning && <button onClick={() => copy(`mean-${r.id}`, r.meaning)} className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{copied === `mean-${r.id}` ? "Copied" : "Copy meaning"}</button>}
                  <button onClick={() => setEditing(r)} className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">Edit</button>
                  <button onClick={() => remove(r)} disabled={busy} className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">Delete</button>
                </div>
              </div>
            )}
          </li>
        ))}
        {!loading && rows.length === 0 && (
          <li className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">No words match.</li>
        )}
        {loading && rows.length === 0 && <li className="py-6 text-center text-sm text-gray-400">Loading…</li>}
      </ul>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40 dark:border-gray-700">Prev</button>
          <span className="text-gray-500 dark:text-gray-400">Page {page} of {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40 dark:border-gray-700">Next</button>
        </div>
      )}
    </section>
  );
}
