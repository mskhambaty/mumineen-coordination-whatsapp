"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";

import { canAccessMumineen, isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Stats = { mumineen: number; adults: number; families: number; registered_families: number; mehmaan: number; local: number };

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
  is_acting_head: boolean;
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
  khidmat_department_ids: string[] | null;
  whatsapp_link_clicked: boolean | null;
  updated_at: string | null;
  family: FamilyDetail | null;
};

type Department = { id: string; name: string };

// Draft state for the modal's edit mode. Dates are held as datetime-local strings; everything
// else mirrors the editable member + family columns. Converted back to ISO/null on save.
type EditForm = {
  local_mehman: string;
  whatsapp_e164: string;
  email: string;
  arrival_at: string;
  arrival_flight_no: string;
  departure_at: string;
  departure_flight_no: string;
  airport: string;
  not_attending: boolean;
  rahat_seating: boolean;
  wheelchair: boolean;
  special_needs: string;
  wants_khidmat: boolean;
  khidmat_department_ids: string[];
  acc_type: string;
  hotel_name: string;
  hotel_address: string;
  open_to_utaro: boolean;
  utaro_host_name: string;
  utaro_host_its: string;
  utaro_host_address: string;
  utaro_host_whatsapp_e164: string;
  utaro_host_email: string;
  transport_mode: string;
  transport_detail: string;
};

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

// ISO timestamp → value for a <input type="datetime-local"> (local time, minute precision).
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local string (interpreted in the admin's local TZ) → ISO, or null when empty/invalid.
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// A labelled row for an edit control.
function EditRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
      <label className="w-44 shrink-0 text-xs uppercase tracking-wide text-gray-400">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// Searchable multiselect of khidmat departments, capped at 3 (admin-styled twin of the one on the
// public registration form).
function KhidmatPicker({ departments, selected, onChange }: { departments: Department[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const nameById = new Map(departments.map((d) => [d.id, d.name]));
  const chosen = new Set(selected);
  const atLimit = selected.length >= 3;
  const matches = departments.filter((d) => !chosen.has(d.id) && d.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {selected.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200">
              {nameById.get(id) ?? id}
              <button type="button" onClick={() => onChange(selected.filter((x) => x !== id))} className="text-blue-700 hover:text-blue-900 dark:text-blue-300" aria-label="Remove">×</button>
            </span>
          ))}
        </div>
      )}
      {atLimit ? (
        <p className="text-xs text-gray-400">Maximum of 3 departments selected. Remove one to change.</p>
      ) : (
        <div className="relative">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off"
            placeholder="Search departments…"
            className={inputCls}
          />
          {open && matches.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900">
              {matches.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); onChange([...selected, d.id]); setQ(""); }}
                    className="block w-full px-3 py-2 text-left text-gray-800 hover:bg-blue-50 dark:text-gray-100 dark:hover:bg-gray-800"
                  >
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

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

type AddMuminForm = {
  its: string;
  full_name: string;
  prefix: string;
  is_head: boolean;
  hof_its: string;
  gender: string;
  local_mehman: string;
  age: string;
  whatsapp_e164: string;
  email: string;
  jamaat: string;
};

const emptyAddForm: AddMuminForm = {
  its: "", full_name: "", prefix: "", is_head: true, hof_its: "",
  gender: "", local_mehman: "Mehman", age: "",
  whatsapp_e164: "", email: "", jamaat: "",
};

type ImportLogEntry = {
  id: string;
  imported_by_name: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  rows_in_file: number | null;
  families_upserted: number | null;
  mumineen_upserted: number | null;
  deactivated_missing: boolean | null;
  auto_columns: string[] | null;
  status: "success" | "error";
  error_message: string | null;
  created_at: string;
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
  const [importHistory, setImportHistory] = useState<ImportLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [utaroQuery, setUtaroQuery] = useState("");
  const [utaroResults, setUtaroResults] = useState<SearchResult[] | null>(null);
  const [utaroTruncated, setUtaroTruncated] = useState(false);
  const [utaroSearching, setUtaroSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utaroTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsAdminUser(isAdminOrLeadership(user));
    if (!canAccessMumineen(user)) {
      router.push("/admin/conversations");
      return;
    }
    void loadStats();
    void loadGate();
    void loadDepartments();
    void loadHistory();
  }, [router]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function closeModal() {
    setSelected(null);
    setEditing(false);
    setForm(null);
  }

  function startEdit(s: SearchResult) {
    setForm({
      local_mehman: s.local_mehman ?? "",
      whatsapp_e164: s.whatsapp_e164 ?? "",
      email: s.email ?? "",
      arrival_at: toLocalInput(s.arrival_at),
      arrival_flight_no: s.arrival_flight_no ?? "",
      departure_at: toLocalInput(s.departure_at),
      departure_flight_no: s.departure_flight_no ?? "",
      airport: s.airport ?? "",
      not_attending: Boolean(s.not_attending),
      rahat_seating: Boolean(s.rahat_seating),
      wheelchair: Boolean(s.wheelchair),
      special_needs: s.special_needs ?? "",
      wants_khidmat: Boolean(s.wants_khidmat),
      khidmat_department_ids: s.khidmat_department_ids ?? [],
      acc_type: s.family?.acc_type ?? "",
      hotel_name: s.family?.hotel_name ?? "",
      hotel_address: s.family?.hotel_address ?? "",
      open_to_utaro: Boolean(s.family?.open_to_utaro),
      utaro_host_name: s.family?.utaro_host_name ?? "",
      utaro_host_its: s.family?.utaro_host_its ?? "",
      utaro_host_address: s.family?.utaro_host_address ?? "",
      utaro_host_whatsapp_e164: s.family?.utaro_host_whatsapp_e164 ?? "",
      utaro_host_email: s.family?.utaro_host_email ?? "",
      transport_mode: s.family?.transport_mode ?? "",
      transport_detail: s.family?.transport_detail ?? "",
    });
    setEditing(true);
  }

  function updateForm(patch: Partial<EditForm>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function saveEdit() {
    if (!selected || !form) return;
    setSaving(true);
    setError(null);
    try {
      const member = {
        local_mehman: form.local_mehman,
        whatsapp_e164: form.whatsapp_e164,
        email: form.email,
        arrival_at: localInputToIso(form.arrival_at),
        arrival_flight_no: form.arrival_flight_no,
        departure_at: localInputToIso(form.departure_at),
        departure_flight_no: form.departure_flight_no,
        airport: form.airport,
        not_attending: form.not_attending,
        wants_khidmat: form.wants_khidmat,
        khidmat_department_ids: form.khidmat_department_ids,
        rahat_seating: form.rahat_seating,
        wheelchair: form.wheelchair,
        special_needs: form.special_needs,
      };
      const family = selected.family
        ? {
            acc_type: form.acc_type,
            hotel_name: form.hotel_name,
            hotel_address: form.hotel_address,
            open_to_utaro: form.open_to_utaro,
            utaro_host_name: form.utaro_host_name,
            utaro_host_its: form.utaro_host_its,
            utaro_host_address: form.utaro_host_address,
            utaro_host_whatsapp_e164: form.utaro_host_whatsapp_e164,
            utaro_host_email: form.utaro_host_email,
            transport_mode: form.transport_mode,
            transport_detail: form.transport_detail,
          }
        : undefined;
      const res = await apiFetch("/api/admin/mumineen/update", {
        method: "POST",
        body: JSON.stringify({ its: selected.its, member, family }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      // Reflect the saved rows in the modal and the search list without a re-open.
      setSelected({ ...selected, ...(data.member ?? {}), family: data.family ?? selected.family });
      setEditing(false);
      setForm(null);
      await runSearch(query.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function loadStats() {
    const res = await apiFetch("/api/admin/mumineen");
    if (res.ok) setStats((await res.json()) as Stats);
  }

  async function loadGate() {
    const res = await apiFetch("/api/admin/registration-gate");
    if (res.ok) setGate(Boolean((await res.json()).enabled));
  }

  async function loadDepartments() {
    const res = await apiFetch("/api/admin/mumineen/departments");
    if (res.ok) setDepartments(((await res.json()).departments as Department[]) ?? []);
  }

  async function loadHistory() {
    setHistoryLoading(true);
    const res = await apiFetch("/api/admin/mumineen/import");
    if (res.ok) setImportHistory((await res.json()) as ImportLogEntry[]);
    setHistoryLoading(false);
  }

  async function toggleGate(next: boolean) {
    setGateBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/registration-gate", {
        method: "POST",
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
      const res = await apiFetch("/api/admin/mumineen/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      const extras: string[] = [];
      if (Array.isArray(data.autoColumns) && data.autoColumns.length > 0) {
        extras.push(`auto-mapped: ${data.autoColumns.join(", ")}`);
      }
      if (data.deactivatedMissing === false) {
        extras.push("additive import — existing roster preserved");
      }
      setMessage(
        `Imported ${data.mumineen} mumineen across ${data.families} families (${data.rows} rows read)` +
          (extras.length ? ` — ${extras.join("; ")}.` : "."),
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadStats();
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function runSearch(term: string) {
    setSearching(true);
    try {
      const res = await apiFetch(`/api/admin/mumineen/search?q=${encodeURIComponent(term)}`);
      const data = await res.json().catch(() => ({}));
      setResults(res.ok ? ((data.results as SearchResult[]) ?? []) : []);
      setTruncated(res.ok ? Boolean(data.truncated) : false);
    } catch {
      setResults([]);
      setTruncated(false);
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

  async function runUtaroSearch(term: string) {
    setUtaroSearching(true);
    try {
      const res = await apiFetch(`/api/admin/mumineen/search?utaro_host=${encodeURIComponent(term)}`);
      const data = await res.json().catch(() => ({}));
      setUtaroResults(res.ok ? ((data.results as SearchResult[]) ?? []) : []);
      setUtaroTruncated(res.ok ? Boolean(data.truncated) : false);
    } catch {
      setUtaroResults([]);
      setUtaroTruncated(false);
    } finally {
      setUtaroSearching(false);
    }
  }

  function onUtaroQueryChange(value: string) {
    setUtaroQuery(value);
    if (utaroTimer.current) clearTimeout(utaroTimer.current);
    const term = value.trim();
    if (term.length < 2) {
      setUtaroResults(null);
      setUtaroSearching(false);
      return;
    }
    setUtaroSearching(true);
    utaroTimer.current = setTimeout(() => runUtaroSearch(term), 300);
  }

  async function unregisterFamily(hofIts: string) {
    if (
      !window.confirm(
        `Unregister family ${hofIts}? This resets them to pending, ERASES all submitted registration details (accommodation, transport, travel), and clears every member's not-attending flag. This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await apiFetch("/api/admin/mumineen/registration", {
        method: "POST",
        body: JSON.stringify({ hof_its: hofIts, action: "unregister" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unregister failed");
      await Promise.all([runSearch(query.trim()), loadStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unregister failed");
    }
  }

  async function markFamilyNotAttending(hofIts: string) {
    if (!window.confirm(`Mark family ${hofIts} as not attending? This registers them and marks all members not attending.`)) return;
    setError(null);
    try {
      const res = await apiFetch("/api/admin/mumineen/registration", {
        method: "POST",
        body: JSON.stringify({ hof_its: hofIts, action: "not_attending" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to mark family not attending");
      await Promise.all([runSearch(query.trim()), loadStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark family not attending");
    }
  }

  async function submitAddMumin(e: React.FormEvent) {
    e.preventDefault();
    if (addSaving) return;
    setAddSaving(true);
    setAddError(null);
    try {
      const body = {
        its: addForm.its.trim(),
        full_name: addForm.full_name.trim(),
        prefix: addForm.prefix.trim() || null,
        is_head: addForm.is_head,
        ...(addForm.is_head ? {} : { hof_its: addForm.hof_its.trim() }),
        gender: addForm.gender || null,
        local_mehman: addForm.local_mehman || null,
        age: addForm.age ? parseInt(addForm.age, 10) : null,
        whatsapp_e164: addForm.whatsapp_e164.trim() || null,
        email: addForm.email.trim() || null,
        jamaat: addForm.jamaat.trim() || null,
      };
      const post = (payload: Record<string, unknown>) =>
        apiFetch("/api/admin/mumineen/create", { method: "POST", body: JSON.stringify(payload) });
      let res = await post(body);
      let data = await res.json().catch(() => ({}));
      // Non-head add whose family doesn't exist yet — confirm creating it, then retry.
      if (!res.ok && data.code === "family_missing") {
        const ok = window.confirm(
          `No family exists for HOF ITS ${addForm.hof_its.trim()}. Create it and add this person? They'll be the acting head until the head — or an older member — is added.`,
        );
        if (!ok) {
          setAddSaving(false);
          return;
        }
        res = await post({ ...body, create_family: true });
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to create mumin");
      setAddOpen(false);
      setAddForm(emptyAddForm);
      await loadStats();
      setQuery(addForm.its.trim());
      await runSearch(addForm.its.trim());
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create mumin");
    } finally {
      setAddSaving(false);
    }
  }

  const cards: { label: string; value: number | undefined }[] = [
    { label: "Mumineen", value: stats?.mumineen },
    { label: "Mehmaan", value: stats?.mehmaan },
    { label: "Local", value: stats?.local },
    { label: "Adults (RSVP targets)", value: stats?.adults },
    { label: "Families", value: stats?.families },
    { label: "Registered families", value: stats?.registered_families },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold">Mumineen Roster</h1>
          {isAdminUser && (
            <button
              type="button"
              onClick={async () => {
                const res = await apiFetch("/api/admin/mumineen/export");
                if (!res.ok) return;
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `mumineen-roster-${new Date().toISOString().slice(0, 10)}.xlsx`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              ↓ Export current roster
            </button>
          )}
        </div>
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
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Lookup mumin</h2>
          <button
            type="button"
            onClick={() => { setAddOpen(true); setAddError(null); setAddForm(emptyAddForm); }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add mumin
          </button>
        </div>
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
                        {r.is_head ? (
                          <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Head</span>
                        ) : r.is_acting_head ? (
                          <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400" title="Roster HOF not in registration data — acting head is the eldest member">Acting head</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.its}</td>
                      <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{r.hof_its ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.age ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.jamaat ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.category ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.city ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.whatsapp_e164 ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.family?.registration_status === "submitted" ? (
                          <span className="text-green-600 dark:text-green-400">submitted</span>
                        ) : (
                          <span className="text-gray-400">{r.family?.registration_status ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.is_acting_head && r.hof_its && r.family?.registration_status === "submitted" ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); unregisterFamily(r.hof_its!); }} className="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">Unregister</button>
                        ) : r.is_acting_head && r.hof_its && r.family && (r.family.registration_status === "not_started" || r.family.registration_status == null) ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); markFamilyNotAttending(r.hof_its!); }} className="rounded border border-amber-300 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950">Family not attending</button>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {truncated && <p className="mt-2 text-xs text-gray-400">Showing the first 50 matching families — refine your search.</p>}
            </div>
          )
        )}
      </div>

      {/* ── Utaro host lookup ── */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">Utaro host lookup</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Enter a host&apos;s name or ITS number to see which mehman families listed them as their utaro host.</p>
        <input
          value={utaroQuery}
          onChange={(e) => onUtaroQueryChange(e.target.value)}
          placeholder="Host name or ITS…"
          className="mt-3 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950"
        />
        {utaroSearching && <p className="mt-2 text-xs text-gray-400">Searching…</p>}
        {utaroResults && !utaroSearching && (
          utaroResults.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No families found with that utaro host.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">ITS</th>
                    <th className="px-2 py-1.5">HOF</th>
                    <th className="px-2 py-1.5">Jamaat</th>
                    <th className="px-2 py-1.5">Utaro host</th>
                    <th className="px-2 py-1.5">Host ITS</th>
                    <th className="px-2 py-1.5">Reg.</th>
                  </tr>
                </thead>
                <tbody>
                  {utaroResults.map((r) => (
                    <tr
                      key={r.its}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                    >
                      <td className="px-2 py-1.5 font-medium">
                        {r.full_name ?? "—"}
                        {r.is_head && (
                          <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Head</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.its}</td>
                      <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{r.hof_its ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.jamaat ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.family?.utaro_host_name ?? "—"}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.family?.utaro_host_its ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.family?.registration_status === "submitted" ? (
                          <span className="text-green-600 dark:text-green-400">submitted</span>
                        ) : (
                          <span className="text-gray-400">{r.family?.registration_status ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {utaroTruncated && <p className="mt-2 text-xs text-gray-400">Showing the first 50 matching families — refine your search.</p>}
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Import roster</h2>
          <a
            href="/templates/mumineen-roster-template.xlsx"
            download
            className="inline-flex w-fit items-center rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950"
          >
            Download template
          </a>
        </div>
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
          Expects columns: Hof Id, Mumin Id, Fullname, Gender, Age, Jamaat, Idara, Category, Prefix, Title, Venue (Waaz), City, Local/Mehman, Arr Place Date, Flight Code, Daily Trans, Whatsapp Link Clicked?, whatsapp_e164, email.
        </p>
      </form>

      {/* ── Import history ── */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold">Import history</h2>
          <button
            type="button"
            onClick={() => void loadHistory()}
            disabled={historyLoading}
            className="text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50"
          >
            {historyLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {importHistory.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400">{historyLoading ? "Loading…" : "No imports yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Uploaded by</th>
                  <th className="px-4 py-2">File</th>
                  <th className="px-4 py-2 text-right">Rows</th>
                  <th className="px-4 py-2 text-right">Families</th>
                  <th className="px-4 py-2 text-right">Mumineen</th>
                  <th className="px-4 py-2">Notes</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {importHistory.map((entry) => {
                  const dt = new Date(entry.created_at);
                  const dateStr = dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                  const timeStr = dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                  const fileSizeStr = entry.file_size_bytes
                    ? entry.file_size_bytes > 1024 * 1024
                      ? `${(entry.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
                      : `${Math.round(entry.file_size_bytes / 1024)} KB`
                    : null;
                  const notes: string[] = [];
                  if (entry.deactivated_missing === false) notes.push("Additive — existing roster preserved");
                  if (entry.auto_columns?.length) notes.push(`Auto-mapped: ${entry.auto_columns.join(", ")}`);
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{dateStr}</span>
                        <span className="ml-1 text-xs text-gray-400">{timeStr}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                        {entry.imported_by_name ?? <span className="text-gray-400 italic">Unknown</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{entry.file_name ?? "—"}</span>
                        {fileSizeStr && <span className="ml-1 text-xs text-gray-400">({fileSizeStr})</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{entry.rows_in_file?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{entry.families_upserted?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{entry.mumineen_upserted?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-2 max-w-xs text-xs text-gray-500 dark:text-gray-400">{notes.join(" · ") || "—"}</td>
                      <td className="px-4 py-2">
                        {entry.status === "success" ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/50 dark:text-green-300">Success</span>
                        ) : (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300" title={entry.error_message ?? ""}>Failed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6"
          onClick={closeModal}
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
              <div className="flex shrink-0 items-center gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={saving}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditing(false); setForm(null); }}
                      disabled={saving}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(selected)}
                    className="rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950"
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="Close"
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
              </div>
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

              {editing && form ? (
                <>
                  <Section title="Personal">
                    <EditRow label="Local / Mehman">
                      <select value={form.local_mehman} onChange={(e) => updateForm({ local_mehman: e.target.value })} className={inputCls}>
                        <option value="">—</option>
                        <option value="Local">Local</option>
                        <option value="Mehman">Mehman</option>
                      </select>
                    </EditRow>
                  </Section>

                  <Section title="Contact">
                    <EditRow label="WhatsApp"><input value={form.whatsapp_e164} onChange={(e) => updateForm({ whatsapp_e164: e.target.value })} placeholder="+1…" className={inputCls} /></EditRow>
                    <EditRow label="Email"><input value={form.email} onChange={(e) => updateForm({ email: e.target.value })} type="email" className={inputCls} /></EditRow>
                  </Section>

                  {form.local_mehman === "Mehman" && (
                    <Section title="Travel">
                      <EditRow label="Arrival"><input value={form.arrival_at} onChange={(e) => updateForm({ arrival_at: e.target.value })} type="datetime-local" className={inputCls} /></EditRow>
                      <EditRow label="Arrival flight"><input value={form.arrival_flight_no} onChange={(e) => updateForm({ arrival_flight_no: e.target.value })} className={inputCls} /></EditRow>
                      <EditRow label="Departure"><input value={form.departure_at} onChange={(e) => updateForm({ departure_at: e.target.value })} type="datetime-local" className={inputCls} /></EditRow>
                      <EditRow label="Departure flight"><input value={form.departure_flight_no} onChange={(e) => updateForm({ departure_flight_no: e.target.value })} className={inputCls} /></EditRow>
                      <EditRow label="Airport">
                        <select value={form.airport} onChange={(e) => updateForm({ airport: e.target.value })} className={inputCls}>
                          <option value="">—</option>
                          <option value="ORD">ORD</option>
                          <option value="MDW">MDW</option>
                        </select>
                      </EditRow>
                    </Section>
                  )}

                  <Section title="Needs / khidmat">
                    <EditRow label="Not attending"><input type="checkbox" checked={form.not_attending} onChange={(e) => updateForm({ not_attending: e.target.checked })} className="h-4 w-4 accent-blue-600" /></EditRow>
                    <EditRow label="Rahat seating"><input type="checkbox" checked={form.rahat_seating} onChange={(e) => updateForm({ rahat_seating: e.target.checked, wheelchair: e.target.checked ? form.wheelchair : false })} className="h-4 w-4 accent-blue-600" /></EditRow>
                    {form.rahat_seating && (
                      <EditRow label="Wheelchair"><input type="checkbox" checked={form.wheelchair} onChange={(e) => updateForm({ wheelchair: e.target.checked })} className="h-4 w-4 accent-blue-600" /></EditRow>
                    )}
                    <EditRow label="Special needs"><input value={form.special_needs} onChange={(e) => updateForm({ special_needs: e.target.value })} className={inputCls} /></EditRow>
                    {form.local_mehman === "Mehman" && (
                      <EditRow label="Wants khidmat"><input type="checkbox" checked={form.wants_khidmat} onChange={(e) => updateForm({ wants_khidmat: e.target.checked, khidmat_department_ids: e.target.checked ? form.khidmat_department_ids : [] })} className="h-4 w-4 accent-blue-600" /></EditRow>
                    )}
                    {form.local_mehman === "Mehman" && form.wants_khidmat && (
                      <EditRow label="Departments">
                        <KhidmatPicker departments={departments} selected={form.khidmat_department_ids} onChange={(ids) => updateForm({ khidmat_department_ids: ids })} />
                      </EditRow>
                    )}
                  </Section>

                  {selected.family && form.local_mehman === "Mehman" && (
                    <Section title="Family registration">
                      <EditRow label="Accommodation">
                        <select value={form.acc_type} onChange={(e) => updateForm({ acc_type: e.target.value })} className={inputCls}>
                          <option value="">—</option>
                          <option value="hotel">Hotel</option>
                          <option value="utaro">Utaro</option>
                        </select>
                      </EditRow>
                      {form.acc_type === "hotel" && (
                        <>
                          <EditRow label="Hotel name"><input value={form.hotel_name} onChange={(e) => updateForm({ hotel_name: e.target.value })} className={inputCls} /></EditRow>
                          <EditRow label="Hotel address"><input value={form.hotel_address} onChange={(e) => updateForm({ hotel_address: e.target.value })} className={inputCls} /></EditRow>
                        </>
                      )}
                      {form.acc_type === "utaro" && (
                        <>
                          <EditRow label="Utaro host"><input value={form.utaro_host_name} onChange={(e) => updateForm({ utaro_host_name: e.target.value })} className={inputCls} /></EditRow>
                          <EditRow label="Utaro host ITS"><input value={form.utaro_host_its} onChange={(e) => updateForm({ utaro_host_its: e.target.value })} className={inputCls} /></EditRow>
                          <EditRow label="Utaro host address"><input value={form.utaro_host_address} onChange={(e) => updateForm({ utaro_host_address: e.target.value })} className={inputCls} /></EditRow>
                          <EditRow label="Utaro host WhatsApp"><input value={form.utaro_host_whatsapp_e164} onChange={(e) => updateForm({ utaro_host_whatsapp_e164: e.target.value })} className={inputCls} /></EditRow>
                          <EditRow label="Utaro host email"><input value={form.utaro_host_email} onChange={(e) => updateForm({ utaro_host_email: e.target.value })} type="email" className={inputCls} /></EditRow>
                        </>
                      )}
                      <EditRow label="Open to utaro"><input type="checkbox" checked={form.open_to_utaro} onChange={(e) => updateForm({ open_to_utaro: e.target.checked })} className="h-4 w-4 accent-blue-600" /></EditRow>
                      <EditRow label="Transport mode">
                        <select value={form.transport_mode} onChange={(e) => updateForm({ transport_mode: e.target.value })} className={inputCls}>
                          <option value="">—</option>
                          <option value="rideshare">Rideshare</option>
                          <option value="rental">Rental</option>
                          <option value="commute_with_utaro">Commute with utaro</option>
                          <option value="other">Other</option>
                        </select>
                      </EditRow>
                      <EditRow label="Transport detail"><input value={form.transport_detail} onChange={(e) => updateForm({ transport_detail: e.target.value })} className={inputCls} /></EditRow>
                    </Section>
                  )}
                </>
              ) : (
                <>
                  <Section title="Contact">
                    <Field label="WhatsApp" value={selected.whatsapp_e164} />
                    <Field label="Email" value={selected.email} />
                    <Field label="WhatsApp link clicked" value={yesOrNull(selected.whatsapp_link_clicked)} />
                  </Section>

                  {selected.local_mehman === "Mehman" && (
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
                  )}

                  <Section title="Needs / khidmat">
                    <Field label="Rahat seating" value={yesOrNull(selected.rahat_seating)} />
                    <Field label="Wheelchair" value={yesOrNull(selected.wheelchair)} />
                    <Field label="Special needs" value={selected.special_needs} />
                    <Field label="Wants khidmat" value={yesOrNull(selected.wants_khidmat)} />
                    <Field
                      label="Khidmat depts"
                      value={
                        selected.khidmat_department_ids && selected.khidmat_department_ids.length > 0
                          ? selected.khidmat_department_ids.map((id) => departments.find((d) => d.id === id)?.name ?? id).join(", ")
                          : null
                      }
                    />
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
                    </Section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h2 className="mb-4 text-lg font-semibold">Add mumin</h2>
            <form onSubmit={(e) => { void submitAddMumin(e); }} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">ITS number *</label>
                <input required value={addForm.its} onChange={(e) => setAddForm((f) => ({ ...f, its: e.target.value }))} className={inputCls} placeholder="e.g. 1234567" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Prefix</label>
                  <input value={addForm.prefix} onChange={(e) => setAddForm((f) => ({ ...f, prefix: e.target.value }))} className={inputCls} placeholder="e.g. Shaikh" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Full name *</label>
                  <input required value={addForm.full_name} onChange={(e) => setAddForm((f) => ({ ...f, full_name: e.target.value }))} className={inputCls} placeholder="e.g. Murtaza Hussain" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is_head" checked={addForm.is_head} onChange={(e) => setAddForm((f) => ({ ...f, is_head: e.target.checked, hof_its: "" }))} className="h-4 w-4" />
                <label htmlFor="is_head" className="text-sm text-gray-700 dark:text-gray-300">This person is the Head of a new family</label>
              </div>
              {!addForm.is_head && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Head of Family ITS *</label>
                  <input required value={addForm.hof_its} onChange={(e) => setAddForm((f) => ({ ...f, hof_its: e.target.value }))} className={inputCls} placeholder="Existing HoF ITS" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Gender</label>
                  <select value={addForm.gender} onChange={(e) => setAddForm((f) => ({ ...f, gender: e.target.value }))} className={inputCls}>
                    <option value="">—</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Type</label>
                  <select value={addForm.local_mehman} onChange={(e) => setAddForm((f) => ({ ...f, local_mehman: e.target.value }))} className={inputCls}>
                    <option value="Mehman">Mehman</option>
                    <option value="Local">Local</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Age</label>
                  <input type="number" min={0} max={150} value={addForm.age} onChange={(e) => setAddForm((f) => ({ ...f, age: e.target.value }))} className={inputCls} placeholder="e.g. 35" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Jamaat</label>
                  <input value={addForm.jamaat} onChange={(e) => setAddForm((f) => ({ ...f, jamaat: e.target.value }))} className={inputCls} placeholder="e.g. Chicago" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">WhatsApp</label>
                <input value={addForm.whatsapp_e164} onChange={(e) => setAddForm((f) => ({ ...f, whatsapp_e164: e.target.value }))} className={inputCls} placeholder="+1..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Email</label>
                <input type="email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} />
              </div>
              {addError && <p className="text-sm text-red-600 dark:text-red-400">{addError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setAddOpen(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600">Cancel</button>
                <button type="submit" disabled={addSaving} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {addSaving ? "Saving…" : "Add mumin"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
