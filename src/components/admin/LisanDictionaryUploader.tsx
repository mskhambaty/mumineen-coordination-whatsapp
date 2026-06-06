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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      </form>
    </section>
  );
}
