"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";

import { canAccessMumineen } from "@/lib/admin/access";

type Stats = { mumineen: number; adults: number; families: number; registered_families: number; cancelled_families: number };

type FamilyDetail = {
  registration_status: string | null;
  submitted_at: string | null;
  submitted_by_its: string | null;
  acc_type: string | null;
  hotel_name: string | null;
  hotel_address: string | null;
  open_to_utaro: boolean | null;
  utaro_host_name: string | null;
  utaro_host_its: string | null;
  utaro_host_address: string | null;
  utaro_host_whatsapp_e164: string | null;
  utaro_host_email: string | null;
  transport_mode: string | null;
  transport_detail: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
};

type SearchResult = {
  its: string;
  full_name: string | null;
  gender: string | null;
  age: number | null;
  jamaat: string | null;
  category: string | null;
  city: string | null;
  hof_its: string | null;
  is_head: boolean;
  whatsapp_e164: string | null;
  email: string | null;
  idara: string | null;
  prefix: string | null;
  title: string | null;
  venue: string | null;
  local_mehman: string | null;
  is_adult: boolean | null;
  arrival_at: string | null;
  arrival_flight_no: string | null;
  departure_at: string | null;
  departure_flight_no: string | null;
  airport: string | null;
  daily_trans: string | null;
  roster_arrival_raw: string | null;
  roster_flight_code: string | null;
  rahat_seating: boolean | null;
  wheelchair: boolean | null;
  special_needs: string | null;
  wants_khidmat: boolean | null;
  not_attending: boolean | null;
  whatsapp_link_clicked: boolean | null;
  updated_at: string | null;
  family: FamilyDetail | null;
};

function fmtDateTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// A single label/value row. Renders nothing when the value is empty (null/undefined/"").
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  if (empty) return null;
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-44 shrink-0 text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

// A titled group of fields. Renders nothing if no child Field produced output.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const hasContent = React.Children.toArray(children).some(Boolean);
  if (!hasContent) return null;
  return (
    <div className="border-t border-gray-100 py-3 first:border-t-0 first:pt-0 dark:border-gray-800">
      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h3>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}

const yesOrNull = (v: boolean | null | undefined) => (v ? "Yes" : null);

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
  const [selected, setSelected] = useState<SearchResult | null>(null);
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
    const user = raw ? JSON.parse(raw) as { role?: string; global_role?: string; is_it?: boolean } : null;
    if (!canAccessMumineen(user)) {
      router.push("/admin/conversations");
      return;
    }
    void loadStats();
    void loadGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

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

  async function runSearch(term: string) {
    setSearching(true);
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
    searchTimer.current = setTimeout(() => runSearch(term), 300);
  }

  async function registrationAction(hofIts: string, action: "cancel" | "reopen") {
    const verb = action === "cancel" ? "Cancel" : "Reopen";
    const reason =
      action === "cancel" ? window.prompt(`Cancel registration for family ${hofIts}?\nOptional reason:`, "") : "";
    if (action === "cancel" && reason === null) return; // user dismissed the prompt
    if (action === "reopen" && !window.confirm(`Reopen registration for family ${hofIts}? They will be able to submit the form again.`)) return;
    setError(null);
    try {
      const res = await fetch("/api/admin/mumineen/registration", {
        method: "POST",
        headers: { "x-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify({ hof_its: hofIts, action, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `${verb} failed`);
      await Promise.all([runSearch(query.trim()), loadStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${verb} failed`);
    }
  }

  const cards: { label: string; value: number | undefined }[] = [
    { label: "Mumineen", value: stats?.mumineen },
    { label: "Adults (RSVP targets)", value: stats?.adults },
    { label: "Families", value: stats?.families },
    { label: "Registered families", value: stats?.registered_families },
    { label: "Cancelled", value: stats?.cancelled_families },
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
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Search by ITS, name, WhatsApp number, HOF ITS, jamaat, or category.</p>
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
                    <th className="px-2 py-1.5">Jamaat</th>
                    <th className="px-2 py-1.5">Category</th>
                    <th className="px-2 py-1.5">City</th>
                    <th className="px-2 py-1.5">WhatsApp</th>
                    <th className="px-2 py-1.5">Reg.</th>
                    <th className="px-2 py-1.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.its}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                    >
                      <td className="px-2 py-1.5 font-medium">
                        {r.full_name ?? "—"}
                        {r.is_head && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Head</span>}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.its}</td>
                      <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{r.hof_its ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.age ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.jamaat ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.category ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.city ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.whatsapp_e164 ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.family?.registration_status === "submitted" || r.family?.registration_status === "confirmed" ? (
                          <span className="text-green-600 dark:text-green-400">{r.family.registration_status}</span>
                        ) : r.family?.registration_status === "cancelled" ? (
                          <span className="text-red-500">cancelled</span>
                        ) : (
                          <span className="text-gray-400">{r.family?.registration_status ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.hof_its && (r.family?.registration_status === "submitted" || r.family?.registration_status === "confirmed") ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); registrationAction(r.hof_its!, "cancel"); }} className="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">Cancel</button>
                        ) : r.hof_its && r.family?.registration_status === "cancelled" ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); registrationAction(r.hof_its!, "reopen"); }} className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Reopen</button>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
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

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6"
          onClick={() => setSelected(null)}
        >
          <div
            className="my-4 w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold">
                  {selected.full_name ?? "—"}
                  {selected.is_head && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Head</span>
                  )}
                </h2>
                <p className="mt-0.5 font-mono text-xs text-gray-500">ITS {selected.its}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-3">
              <Section title="Personal">
                <Field label="Name" value={selected.full_name} />
                <Field label="ITS" value={selected.its} />
                <Field label="Prefix / Title" value={[selected.prefix, selected.title].filter(Boolean).join(" ") || null} />
                <Field label="Gender" value={selected.gender} />
                <Field label="Age" value={selected.age} />
                <Field label="Adult" value={yesOrNull(selected.is_adult)} />
                <Field label="Head of family" value={yesOrNull(selected.is_head)} />
                <Field label="HOF ITS" value={selected.hof_its} />
                <Field label="Jamaat" value={selected.jamaat} />
                <Field label="Idara" value={selected.idara} />
                <Field label="Category" value={selected.category} />
                <Field label="Venue" value={selected.venue} />
                <Field label="City" value={selected.city} />
                <Field label="Local / Mehman" value={selected.local_mehman} />
              </Section>

              <Section title="Contact">
                <Field label="WhatsApp" value={selected.whatsapp_e164} />
                <Field label="Email" value={selected.email} />
                <Field label="WhatsApp link clicked" value={yesOrNull(selected.whatsapp_link_clicked)} />
              </Section>

              <Section title="Travel">
                <Field label="Arrival" value={fmtDateTime(selected.arrival_at)} />
                <Field label="Arrival flight" value={selected.arrival_flight_no} />
                <Field label="Departure" value={fmtDateTime(selected.departure_at)} />
                <Field label="Departure flight" value={selected.departure_flight_no} />
                <Field label="Airport" value={selected.airport} />
                <Field label="Daily transport" value={selected.daily_trans} />
                <Field label="Roster arrival (raw)" value={selected.roster_arrival_raw} />
                <Field label="Roster flight code" value={selected.roster_flight_code} />
              </Section>

              <Section title="Needs / khidmat">
                <Field label="Rahat seating" value={yesOrNull(selected.rahat_seating)} />
                <Field label="Wheelchair" value={yesOrNull(selected.wheelchair)} />
                <Field label="Special needs" value={selected.special_needs} />
                <Field label="Wants khidmat" value={yesOrNull(selected.wants_khidmat)} />
                <Field label="Not attending" value={yesOrNull(selected.not_attending)} />
              </Section>

              {selected.family && (
                <Section title="Family registration">
                  <Field label="Status" value={selected.family.registration_status} />
                  <Field label="Submitted" value={fmtDateTime(selected.family.submitted_at)} />
                  <Field label="Submitted by ITS" value={selected.family.submitted_by_its} />
                  <Field label="Accommodation" value={selected.family.acc_type} />
                  <Field label="Hotel name" value={selected.family.hotel_name} />
                  <Field label="Hotel address" value={selected.family.hotel_address} />
                  <Field label="Open to utaro" value={yesOrNull(selected.family.open_to_utaro)} />
                  <Field label="Utaro host" value={selected.family.utaro_host_name} />
                  <Field label="Utaro host ITS" value={selected.family.utaro_host_its} />
                  <Field label="Utaro host address" value={selected.family.utaro_host_address} />
                  <Field label="Utaro host WhatsApp" value={selected.family.utaro_host_whatsapp_e164} />
                  <Field label="Utaro host email" value={selected.family.utaro_host_email} />
                  <Field label="Transport mode" value={selected.family.transport_mode} />
                  <Field label="Transport detail" value={selected.family.transport_detail} />
                  <Field label="Cancelled" value={fmtDateTime(selected.family.cancelled_at)} />
                  <Field label="Cancel reason" value={selected.family.cancelled_reason} />
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
