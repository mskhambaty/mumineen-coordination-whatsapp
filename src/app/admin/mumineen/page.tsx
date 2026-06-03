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
  const [gate, setGate] = useState<boolean | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
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
    void loadGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadStats() {
    const res = await fetch("/api/admin/mumineen", { headers: { "x-admin-key": adminKey } });
    if (res.ok) setStats((await res.json()) as Stats);
  }

  async function loadGate() {
    const res = await fetch("/api/admin/registration-gate", { headers: { "x-admin-key": adminKey } });
    if (res.ok) setGate(Boolean((await res.json()).enabled));
  }

  async function toggleGate(next: boolean) {
    setGateBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/registration-gate", {
        method: "POST",
        headers: { "x-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to update gate");
      setGate(Boolean(data.enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update gate");
    } finally {
      setGateBusy(false);
    }
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

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">WhatsApp registration gate</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              When ON, unregistered numbers get a nudge to register instead of an agent reply. Committee,
              admin and support numbers always bypass it.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={gate === true}
            disabled={gate === null || gateBusy}
            onClick={() => toggleGate(!gate)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              gate ? "bg-green-600" : "bg-gray-300 dark:bg-gray-700"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                gate ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        <p className="mt-3 text-sm font-medium">
          Status:{" "}
          {gate === null ? (
            <span className="text-gray-400">loading…</span>
          ) : gate ? (
            <span className="text-green-700 dark:text-green-400">ON — unregistered numbers are gated</span>
          ) : (
            <span className="text-gray-600 dark:text-gray-300">OFF — everyone reaches the agent</span>
          )}
        </p>
        {gate && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Heads up: roster members who haven&apos;t submitted the registration form count as
            unregistered and will be nudged. Only turn this on once families have started registering.
          </div>
        )}
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
