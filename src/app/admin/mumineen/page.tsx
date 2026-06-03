"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";

type Stats = { mumineen: number; adults: number; families: number; registered_families: number };

type SearchResult = {
  its: string;
  full_name: string | null;
  gender: string | null;
  age: number | null;
  jamaat: string | null;
  city: string | null;
  hof_its: string | null;
  is_head: boolean;
  whatsapp_e164: string | null;
  email: string | null;
  family: { registration_status: string | null } | null;
};

export default function MumineenPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<boolean | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  function onQueryChange(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = value.trim();
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/mumineen/search?q=${encodeURIComponent(term)}`, {
          headers: { "x-admin-key": adminKey },
        });
        const data = await res.json().catch(() => ({}));
        setResults(res.ok ? ((data.results as SearchResult[]) ?? []) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
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
        <h2 className="text-lg font-semibold">Lookup mumin</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Search by ITS, name, WhatsApp number, or HOF ITS.</p>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Start typing a name or ITS…"
          className="mt-3 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950"
        />
        {searching && <p className="mt-2 text-xs text-gray-400">Searching…</p>}
        {results && !searching && (
          results.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No matches.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">ITS</th>
                    <th className="px-2 py-1.5">HOF</th>
                    <th className="px-2 py-1.5">Age</th>
                    <th className="px-2 py-1.5">City</th>
                    <th className="px-2 py-1.5">WhatsApp</th>
                    <th className="px-2 py-1.5">Reg.</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.its} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1.5 font-medium">
                        {r.full_name ?? "—"}
                        {r.is_head && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Head</span>}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.its}</td>
                      <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{r.hof_its ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.age ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.city ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.whatsapp_e164 ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.family?.registration_status === "submitted" || r.family?.registration_status === "confirmed" ? (
                          <span className="text-green-600 dark:text-green-400">{r.family.registration_status}</span>
                        ) : (
                          <span className="text-gray-400">{r.family?.registration_status ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length === 50 && <p className="mt-2 text-xs text-gray-400">Showing first 50 matches — refine your search.</p>}
            </div>
          )
        )}
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
