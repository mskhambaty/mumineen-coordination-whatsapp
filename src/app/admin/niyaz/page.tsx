"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Meal = "lunch" | "dinner";
type ServingType = "thaal" | "packet";

// One Niyaz event with its per-event attendance tallies (from the niyaz_event_tallies view).
type NiyazEvent = {
  id: string;
  title: string;
  eventDate: string; // YYYY-MM-DD
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
};

type RespRow = {
  id: string;
  attending: boolean;
  source: string;
  responded_by_phone: string | null;
  updated_at: string;
  mumin: { full_name: string | null; its: string | null; is_adult: boolean | null } | null;
  family: { hof_its: string | null } | null;
};
type Summary = {
  responded: number;
  yes_adults: number;
  yes_kids: number;
  yes_families: number;
  no_adults: number;
  no_kids: number;
  no_families: number;
};

type InstanceForm = {
  title: string;
  event_date: string;
  meal: "" | Meal;
  serving_type: "" | ServingType;
  description: string;
};

type Composer = {
  audience: "specific_its" | "all_mumineen" | "all_hof" | "all_adults";
  its: string;
  onlyNonResponders: boolean;
  level: "ind" | "fam";
  templateCode: string;
};

const emptyInstanceForm: InstanceForm = { title: "", event_date: "", meal: "", serving_type: "", description: "" };
const emptyComposer: Composer = { audience: "specific_its", its: "", onlyNonResponders: false, level: "ind", templateCode: "" };

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

  const [events, setEvents] = useState<NiyazEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InstanceForm>(emptyInstanceForm);
  const [saving, setSaving] = useState(false);

  // Per-event detail
  const [selected, setSelected] = useState<NiyazEvent | null>(null);
  const [responses, setResponses] = useState<RespRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [templates, setTemplates] = useState<{ name: string }[]>([]);
  const [composer, setComposer] = useState<Composer>(emptyComposer);
  const [count, setCount] = useState<number | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

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

  async function loadEvents() {
    const res = await apiFetch("/api/admin/niyaz/instances");
    if (res.ok) setEvents(((await res.json()).instances as NiyazEvent[]) ?? []);
  }

  async function loadTemplates() {
    const res = await apiFetch("/api/admin/templates");
    if (res.ok) setTemplates((((await res.json()).templates as { name: string }[]) ?? []).map((t) => ({ name: t.name })));
  }

  const loadResponses = useCallback(async (instanceId: string) => {
    const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/responses`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setResponses((data.responses as RespRow[]) ?? []);
      setSummary((data.summary as Summary) ?? null);
    }
  }, []);

  function selectEvent(e: NiyazEvent) {
    setSelected(e);
    setSendMsg(null);
    setComposer(emptyComposer);
    setCount(null);
    setUnresolved([]);
    void loadResponses(e.id);
    if (templates.length === 0) void loadTemplates();
  }

  // Live recipient-count preview for the composer.
  useEffect(() => {
    if (!selected) return;
    const q = new URLSearchParams({
      audience: composer.audience,
      level: composer.level,
      only_non_responders: String(composer.onlyNonResponders),
      its: composer.its,
    });
    let cancelled = false;
    void apiFetch(`/api/admin/niyaz/instances/${selected.id}/broadcast?${q.toString()}`).then(async (res) => {
      if (cancelled) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCount((data.count as number) ?? 0);
        setUnresolved((data.unresolved_its as string[]) ?? []);
      } else {
        setCount(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selected, composer.audience, composer.level, composer.onlyNonResponders, composer.its]);

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

  async function sendBroadcast() {
    if (!selected) return;
    if (!composer.templateCode) {
      setSendMsg("Pick a template first.");
      return;
    }
    setSending(true);
    setSendMsg(null);
    try {
      const res = await apiFetch(`/api/admin/niyaz/instances/${selected.id}/broadcast`, {
        method: "POST",
        body: JSON.stringify({
          audience: composer.audience,
          its: composer.its.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
          only_non_responders: composer.onlyNonResponders,
          level: composer.level,
          template_code: composer.templateCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      const unres = (data.unresolved_its as string[]) ?? [];
      setSendMsg(`Queued ${data.total ?? 0} message(s).${unres.length ? ` Unresolved ITS: ${unres.join(", ")}.` : ""}`);
      await loadResponses(selected.id);
    } catch (err) {
      setSendMsg(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  const num = "px-2 py-1.5 text-right tabular-nums";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Niyaz Registration</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            RSVP is collected per day via WhatsApp buttons. Click an event to see responses and send a request.
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
        <h2 className="mb-3 text-lg font-semibold">Niyaz events</h2>
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
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Send composer */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-1 text-lg font-semibold">Send RSVP request</h2>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{selected.title || dayLabel(selected.eventDate)} · {dayLabel(selected.eventDate)}</p>
            <div className="space-y-3">
              <label className="block text-xs uppercase tracking-wide text-gray-400">Level
                <select value={composer.level} onChange={(e) => setComposer({ ...composer, level: e.target.value as Composer["level"] })} className={inputCls}>
                  <option value="ind">Individual (records the responder)</option>
                  <option value="fam">Family (records the whole family)</option>
                </select>
              </label>
              <label className="block text-xs uppercase tracking-wide text-gray-400">Audience
                <select value={composer.audience} onChange={(e) => setComposer({ ...composer, audience: e.target.value as Composer["audience"] })} className={inputCls}>
                  <option value="specific_its">Specific ITS (test)</option>
                  <option value="all_mumineen">All mumineen</option>
                  <option value="all_hof">All HOF (one per family)</option>
                  <option value="all_adults">All adults</option>
                </select>
              </label>
              {composer.audience === "specific_its" && (
                <label className="block text-xs uppercase tracking-wide text-gray-400">ITS numbers (comma/space separated)
                  <textarea value={composer.its} onChange={(e) => setComposer({ ...composer, its: e.target.value })} rows={2} className={inputCls} placeholder="40495151, 30412345" />
                </label>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={composer.onlyNonResponders} onChange={(e) => setComposer({ ...composer, onlyNonResponders: e.target.checked })} />
                Only those who haven&apos;t responded to this event
              </label>
              <label className="block text-xs uppercase tracking-wide text-gray-400">Template
                <select value={composer.templateCode} onChange={(e) => setComposer({ ...composer, templateCode: e.target.value })} className={inputCls}>
                  <option value="">Select an approved template…</option>
                  {templates.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </label>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Recipients: <span className="font-semibold">{count ?? "…"}</span>
                {unresolved.length > 0 && <span className="ml-2 text-amber-600">Unresolved ITS: {unresolved.join(", ")}</span>}
              </div>
              <button type="button" onClick={sendBroadcast} disabled={sending || !count} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700">
                {sending ? "Sending…" : "Send"}
              </button>
              {sendMsg && <p className="text-sm text-gray-600 dark:text-gray-300">{sendMsg}</p>}
            </div>
          </div>

          {/* Responses */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Responses</h2>
              {summary && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Yes {summary.yes_adults + summary.yes_kids} ({summary.yes_families} fam) · No {summary.no_adults + summary.no_kids} ({summary.no_families} fam)
                </p>
              )}
            </div>
            {responses.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No responses yet.</p>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-400">
                    <tr>
                      <th className="px-2 py-1.5">Name</th>
                      <th className="px-2 py-1.5">RSVP</th>
                      <th className="px-2 py-1.5">Source</th>
                      <th className="px-2 py-1.5">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responses.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-2 py-1.5">
                          {r.mumin?.full_name ?? r.mumin?.its ?? "—"}
                          {r.mumin?.is_adult === false ? <span className="ml-1 text-xs text-gray-400">(kid)</span> : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={r.attending ? "text-green-600 dark:text-green-400" : "text-red-500"}>{r.attending ? "Yes" : "No"}</span>
                        </td>
                        <td className="px-2 py-1.5 text-xs text-gray-500">{r.source}</td>
                        <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
                      </tr>
                    ))}
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
