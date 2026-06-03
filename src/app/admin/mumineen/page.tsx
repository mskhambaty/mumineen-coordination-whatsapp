"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";

type Stats = { mumineen: number; adults: number; families: number; registered_families: number };

export default function MumineenPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const raw = localStorage.getItem("admin_user");
    const user = raw ? JSON.parse(raw) as { role?: string; global_role?: string } : null;
    if (!isAdminOrLeadership(user)) {
      router.push("/admin/conversations");
      return;
    }
    void loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadStats() {
    const res = await fetch("/api/admin/mumineen", { headers: { "x-admin-key": adminKey } });
    if (res.ok) setStats((await res.json()) as Stats);
  }

  async function runImport(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/mumineen/import", { method: "POST", headers: { "x-admin-key": adminKey }, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setMessage(`Imported ${data.mumineen} mumineen across ${data.families} families (${data.rows} rows read).`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const cards: { label: string; value: number | undefined }[] = [
    { label: "Mumineen", value: stats?.mumineen },
    { label: "Adults (RSVP targets)", value: stats?.adults },
    { label: "Families", value: stats?.families },
    { label: "Registered families", value: stats?.registered_families },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold">Mumineen Roster</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Import the attendee roster (Excel). Re-importing is safe — it refreshes roster fields and never
          overwrites registration details families have submitted.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <p className="text-2xl font-bold">{c.value ?? "—"}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{c.label}</p>
          </div>
        ))}
      </div>

      <form onSubmit={runImport} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">Import roster</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 dark:text-gray-300"
          />
          <button
            type="submit"
            disabled={!file || importing}
            className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
        {message && <p className="mt-3 text-sm font-medium text-green-700 dark:text-green-400">{message}</p>}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Expects columns: Hof Id, Mumin Id, Fullname, Gender, Age, Jamaat, Idara, Category, Prefix, Title, Venue, City, Local/Mehman, Arr Place Date, Flight Code, Daily Trans, Whatsapp Link Clicked.
        </p>
      </form>
    </main>
  );
}
