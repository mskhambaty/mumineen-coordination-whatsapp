"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/admin/client";

// Uploads the Lisan ud Dawat dictionary CSV into the exact-lookup table (lisan_words),
// powering the get_lisan_word_meaning tool. Full-replace on each upload.
export default function LisanDictionaryUploader() {
  const [count, setCount] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Single-word add (the day-to-day path — DB is the source of truth).
  const [word, setWord] = useState({ transliteration: "", lisan: "", meaning: "", example: "" });
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function fetchCount(): Promise<number | null> {
    try {
      const res = await apiFetch("/api/admin/lisan-words");
      if (res.ok) return ((await res.json()).count ?? 0) as number;
    } catch {
      // ignore
    }
    return null;
  }

  useEffect(() => {
    void (async () => {
      const c = await fetchCount();
      if (c !== null) setCount(c);
    })();

  }, []);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch("/api/admin/lisan-words", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setMessage(`Imported ${data.count ?? 0} words.`);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      const c = await fetchCount();
      if (c !== null) setCount(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function addWord(e: React.FormEvent) {
    e.preventDefault();
    if (!word.transliteration.trim() && !word.lisan.trim()) return;
    setAdding(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch("/api/admin/lisan-words", { method: "PUT", body: JSON.stringify(word) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Add failed");
      const label = word.transliteration.trim() || word.lisan.trim();
      setMessage(data.status === "updated" ? `Updated “${label}”.` : `Added “${label}”.`);
      setWord({ transliteration: "", lisan: "", meaning: "", example: "" });
      if (typeof data.count === "number") setCount(data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setAdding(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/lisan-words?format=csv");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("content-disposition") ?? "";
      a.download = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "lisan-dictionary.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100";

  return (
    <section className="mt-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-lg font-semibold">Lisan ud Dawat Dictionary (exact lookup)</h2>
      <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
        Upload the dictionary CSV (columns: Word/Transliteration, Lisan, Meaning, Example). Powers the
        agent&apos;s exact word lookup with &quot;did you mean&quot; suggestions — separate from the vector store.
        Uploading replaces the whole dictionary.
        {count !== null && <span className="ml-1 font-medium text-gray-700 dark:text-gray-300">Currently loaded: {count.toLocaleString()} words.</span>}
      </p>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}
      {message && <p className="mt-3 text-sm font-medium text-green-700 dark:text-green-400">{message}</p>}

      <form onSubmit={upload} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 dark:text-gray-300"
        />
        <button
          type="submit"
          disabled={!file || uploading}
          className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
        >
          {uploading ? "Importing…" : "Upload & Replace"}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting}
          className="shrink-0 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </form>

      {/* Day-to-day path: add ONE missing word without re-uploading the whole CSV. */}
      <div className="mt-6 border-t border-gray-100 pt-5 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Add a word</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Adds a single word live (no full re-upload). Re-adding an existing word updates it.
        </p>
        <form onSubmit={addWord} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={word.transliteration}
            onChange={(e) => setWord((w) => ({ ...w, transliteration: e.target.value }))}
            placeholder="Transliteration (e.g. Aflaak)"
            className={inputClass}
          />
          <input
            value={word.lisan}
            onChange={(e) => setWord((w) => ({ ...w, lisan: e.target.value }))}
            placeholder="Lisan (e.g. افلاك)"
            dir="rtl"
            className={inputClass}
          />
          <input
            value={word.meaning}
            onChange={(e) => setWord((w) => ({ ...w, meaning: e.target.value }))}
            placeholder="Meaning"
            className={inputClass}
          />
          <input
            value={word.example}
            onChange={(e) => setWord((w) => ({ ...w, example: e.target.value }))}
            placeholder="Example (optional)"
            className={inputClass}
          />
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={adding || (!word.transliteration.trim() && !word.lisan.trim())}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {adding ? "Adding…" : "Add word"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
