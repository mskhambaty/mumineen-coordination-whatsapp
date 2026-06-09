"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

type InstanceForm = {
  title: string;
  event_date: string;
  meal: "" | Meal;
  serving_type: "" | ServingType;
  description: string;
};

const emptyInstanceForm: InstanceForm = { title: "", event_date: "", meal: "", serving_type: "", description: "" };

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

  const num = "px-2 py-1.5 text-right tabular-nums";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Niyaz Registration</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Every mumin is RSVP&apos;d by default from their arrival date. Counts update as families respond to the bot.
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
                  <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
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
                    <td className="px-2 py-1.5">
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
    </main>
  );
}
