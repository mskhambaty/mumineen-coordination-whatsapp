"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Meal = "lunch" | "dinner";
type ServingType = "thaal" | "packet";

// One Niyaz event with its per-event attendance tallies (from the niyaz_event_tallies view) plus the
// free-text family head-count total and the combined RSVP count.
type TallyMode = "max" | "min";

type NiyazEvent = {
  id: string;
  title: string;
  eventDate: string; // YYYY-MM-DD
  hijriDate: string | null;
  meal: Meal | null;
  servingType: ServingType | null;
  description: string | null;
  yesAdults: number;
  yesKids: number;
  yesFamilies: number;
  thaalCount: number;
  noAdults: number;
  noKids: number;
  noFamilies: number;
  unregAdults: number;
  unregKids: number;
  headcountHeads: number;
  rsvpCount: number;
};

type RespRow = {
  id: string;
  attending: boolean;
  source: string;
  responded_by_phone: string | null;
  recorded_by: string | null;
  updated_at: string;
  mumin: { full_name: string | null; its: string | null; is_adult: boolean | null } | null;
  family: { hof_its: string | null } | null;
};

// How each niyaz_rsvp row got its value — lets staff tell a real confirmation from a seeded default.
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  default: { label: "Seeded (arrival)", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  registration: { label: "Registration", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  whatsapp: { label: "WhatsApp", cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
  admin: { label: "Admin", cls: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
};

function sourceMeta(source: string) {
  return SOURCE_META[source] ?? { label: source || "—", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" };
}
type Summary = {
  responded: number;
  yes_adults: number;
  yes_kids: number;
  yes_families: number;
  no_adults: number;
  no_kids: number;
  no_families: number;
  headcount_families: number;
  headcount_total: number;
};

type InstanceForm = {
  title: string;
  event_date: string;
  hijri_date: string;
  meal: "" | Meal;
  serving_type: "" | ServingType;
  description: string;
};

type HeadCount = { id: string; head_count: number; responded_by_phone: string | null; updated_at: string; family: { hof_its: string | null } | null };

const emptyInstanceForm: InstanceForm = { title: "", event_date: "", hijri_date: "", meal: "", serving_type: "", description: "" };

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function NiyazPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<TallyMode>("max");
  const [events, setEvents] = useState<NiyazEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InstanceForm>(emptyInstanceForm);
  const [saving, setSaving] = useState(false);

  // Per-event detail (responses view; the Send RSVP composer is removed for now)
  const [selected, setSelected] = useState<NiyazEvent | null>(null);
  const [responses, setResponses] = useState<RespRow[]>([]);
  const [headcounts, setHeadcounts] = useState<HeadCount[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [respSearch, setRespSearch] = useState("");

  const q = respSearch.trim().toLowerCase();
  const filteredResponses = q
    ? responses.filter(
        (r) =>
          (r.mumin?.full_name ?? "").toLowerCase().includes(q) ||
          (r.mumin?.its ?? "").toLowerCase().includes(q) ||
          (r.family?.hof_its ?? "").toLowerCase().includes(q),
      )
    : responses;

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    if (!canAccessPortal(user)) {
      router.push("/admin/conversations");
      return;
    }
    void loadEvents();
  }, [router]);

  async function loadEvents(m: TallyMode = mode) {
    const res = await apiFetch(`/api/admin/niyaz/instances?mode=${m}`);
    if (res.ok) setEvents(((await res.json()).instances as NiyazEvent[]) ?? []);
  }

  function switchMode(m: TallyMode) {
    setMode(m);
    void loadEvents(m);
  }

  const loadResponses = useCallback(async (instanceId: string) => {
    const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/responses`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setResponses((data.responses as RespRow[]) ?? []);
      setHeadcounts((data.headcounts as HeadCount[]) ?? []);
      setSummary((data.summary as Summary) ?? null);
    }
  }, []);

  function selectEvent(e: NiyazEvent) {
    setSelected(e);
    setRespSearch("");
    void loadResponses(e.id);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyInstanceForm);
    setShowForm(true);
  }

  function openEdit(e: NiyazEvent) {
    setEditingId(e.id);
    setForm({
      title: e.title,
      event_date: e.eventDate ?? "",
      hijri_date: e.hijriDate ?? "",
      meal: e.meal ?? "",
      serving_type: e.servingType ?? "",
      description: e.description ?? "",
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title,
        event_date: form.event_date || null,
        hijri_date: form.hijri_date || null,
        meal: form.meal || null,
        serving_type: form.serving_type || null,
        description: form.description,
      };
      const url = editingId ? `/api/admin/niyaz/instances/${editingId}` : "/api/admin/niyaz/instances";
      const res = await apiFetch(url, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setShowForm(false);
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const num = "px-2 py-1.5 text-right tabular-nums";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Niyaz Registration</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Click an event to see its RSVP responses.
          </p>
        </div>
        <button type="button" onClick={openCreate} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          New event
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {showForm && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-lg font-semibold">{editingId ? "Edit event" : "New event"}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-xs uppercase tracking-wide text-gray-400">Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Day
              <input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Hijri date
              <input value={form.hijri_date} onChange={(e) => setForm({ ...form, hijri_date: e.target.value })} className={inputCls} placeholder="2 Muharram al-Haram 1448H" />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Meal
              <select value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value as InstanceForm["meal"] })} className={inputCls}>
                <option value="">—</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
              </select>
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Serving type
              <select value={form.serving_type} onChange={(e) => setForm({ ...form, serving_type: e.target.value as InstanceForm["serving_type"] })} className={inputCls}>
                <option value="">—</option>
                <option value="thaal">Thaal</option>
                <option value="packet">Packet</option>
              </select>
            </label>
            <label className="sm:col-span-2 text-xs uppercase tracking-wide text-gray-400">Description
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={inputCls} />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Niyaz events</h2>
          <div className="flex gap-1 rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
            <button
              type="button"
              onClick={() => switchMode("max")}
              className={`rounded px-3 py-1 text-xs font-medium ${mode === "max" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
              title="All registered members assumed attending from arrival date"
            >
              Max
            </button>
            <button
              type="button"
              onClick={() => switchMode("min")}
              className={`rounded px-3 py-1 text-xs font-medium ${mode === "min" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
              title="Only members who actively confirmed via WhatsApp or admin"
            >
              Min
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {mode === "max" ? (
            <>
              <span className="font-semibold text-gray-700 dark:text-gray-200">Max (kitchen-planning upper bound):</span>{" "}
              every registered member is counted as attending from their arrival date, then adjusted by any WhatsApp or
              admin changes. Use this to prepare enough food.
            </>
          ) : (
            <>
              <span className="font-semibold text-gray-700 dark:text-gray-200">Min (confirmed only):</span>{" "}
              counts only members who actively said yes via WhatsApp or an admin — arrival-date defaults are excluded.
              Use this to see who has explicitly confirmed.
            </>
          )}{" "}
          Thaals = ceil(attending heads ÷ 8). Unreg columns are guests not linked to a registered family.
        </p>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No Niyaz events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-400">
                <tr>
                  <th className="px-2 py-1.5">Event</th>
                  <th className="px-2 py-1.5 text-right">Yes adults</th>
                  <th className="px-2 py-1.5 text-right">Yes kids</th>
                  <th className="px-2 py-1.5 text-right">Yes families</th>
                  <th className="px-2 py-1.5 text-right">Thaals</th>
                  <th className="px-2 py-1.5 text-right">No adults</th>
                  <th className="px-2 py-1.5 text-right">No kids</th>
                  <th className="px-2 py-1.5 text-right">No families</th>
                  <th className="px-2 py-1.5 text-right" title="Unregistered adults">Unreg</th>
                  <th className="px-2 py-1.5 text-right" title="Unregistered kids">Unreg kids</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => selectEvent(e)}
                    className={`cursor-pointer border-t border-gray-100 dark:border-gray-800 ${selected?.id === e.id ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{e.title || dayLabel(e.eventDate)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {dayLabel(e.eventDate)}
                        {e.meal ? ` · ${e.meal}` : ""}
                        {e.servingType ? ` · ${e.servingType}` : ""}
                      </div>
                    </td>
                    <td className={num}>{e.yesAdults}</td>
                    <td className={num}>{e.yesKids}</td>
                    <td className={num}>{e.yesFamilies}</td>
                    <td className={`${num} font-semibold`}>{e.thaalCount}</td>
                    <td className={`${num} text-gray-500`}>{e.noAdults}</td>
                    <td className={`${num} text-gray-500`}>{e.noKids}</td>
                    <td className={`${num} text-gray-500`}>{e.noFamilies}</td>
                    <td className={`${num} text-orange-600 dark:text-orange-400`}>{e.unregAdults || ""}</td>
                    <td className={`${num} text-orange-600 dark:text-orange-400`}>{e.unregKids || ""}</td>
                    <td className="px-2 py-1.5" onClick={(ev) => ev.stopPropagation()}>
                      <button type="button" onClick={() => openEdit(e)} className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-6">
          {/* Responses */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Responses — {selected.title || dayLabel(selected.eventDate)}</h2>
              {summary && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Yes {summary.yes_adults + summary.yes_kids} ({summary.yes_families} fam) · No {summary.no_adults + summary.no_kids} ({summary.no_families} fam)
                  {summary.headcount_families ? ` · Head counts: ${summary.headcount_total} (${summary.headcount_families} fam)` : ""}
                </p>
              )}
            </div>

            {responses.length > 0 && (
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="search"
                  value={respSearch}
                  onChange={(e) => setRespSearch(e.target.value)}
                  placeholder="Search by name or ITS…"
                  className={`${inputCls} max-w-xs`}
                />
                {q && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {filteredResponses.length} of {responses.length}
                  </span>
                )}
              </div>
            )}

            {headcounts.length > 0 && (
              <div className="mb-4 rounded-md border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Family head counts</h3>
                <div className="max-h-40 overflow-auto text-sm">
                  {headcounts.map((h) => (
                    <div key={h.id} className="flex justify-between border-t border-gray-100 py-1 dark:border-gray-800">
                      <span className="font-mono text-xs">{h.family?.hof_its ?? "—"}</span>
                      <span className="font-semibold">{h.head_count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {responses.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No responses yet.</p>
            ) : filteredResponses.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No responses match “{respSearch}”.</p>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs uppercase text-gray-400 dark:bg-gray-900">
                    <tr>
                      <th className="px-2 py-1.5">Name</th>
                      <th className="px-2 py-1.5">ITS</th>
                      <th className="px-2 py-1.5">RSVP</th>
                      <th className="px-2 py-1.5" title="How this RSVP was set">Source</th>
                      <th className="px-2 py-1.5" title="Phone (WhatsApp) or admin who set it">Responded by</th>
                      <th className="px-2 py-1.5">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResponses.map((r) => {
                      const meta = sourceMeta(r.source);
                      return (
                        <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="px-2 py-1.5">
                            {r.mumin?.full_name ?? r.mumin?.its ?? "—"}
                            {r.mumin?.is_adult === false ? <span className="ml-1 text-xs text-gray-400">(kid)</span> : null}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{r.mumin?.its ?? "—"}</td>
                          <td className="px-2 py-1.5">
                            <span className={r.attending ? "text-green-600 dark:text-green-400" : "text-red-500"}>{r.attending ? "Yes" : "No"}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                          </td>
                          <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{r.responded_by_phone ?? r.recorded_by ?? "—"}</td>
                          <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
