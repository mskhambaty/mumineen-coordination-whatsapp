"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";

type Meal = "lunch" | "dinner";
type ServingType = "thaal" | "packet";

// The subset of a Niyaz event the form edits. The list page's richer NiyazEvent is compatible.
export type EditableInstance = {
  id: string;
  title: string;
  eventDate: string | null;
  hijriDate: string | null;
  meal: Meal | null;
  servingType: ServingType | null;
  description: string | null;
};

type InstanceForm = {
  title: string;
  event_date: string;
  hijri_date: string;
  meal: "" | Meal;
  serving_type: "" | ServingType;
  description: string;
};

const emptyForm: InstanceForm = { title: "", event_date: "", hijri_date: "", meal: "", serving_type: "", description: "" };

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

function formFor(instance: EditableInstance | null): InstanceForm {
  if (!instance) return emptyForm;
  return {
    title: instance.title ?? "",
    event_date: instance.eventDate ?? "",
    hijri_date: instance.hijriDate ?? "",
    meal: instance.meal ?? "",
    serving_type: instance.servingType ?? "",
    description: instance.description ?? "",
  };
}

/**
 * Modal for creating or editing a Niyaz event (registration instance). Reuses the
 * POST /api/admin/niyaz/instances and PATCH /api/admin/niyaz/instances/{id} endpoints.
 */
export default function EventFormModal({
  open,
  instance,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null → create mode; an instance → edit mode. */
  instance: EditableInstance | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<InstanceForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the modal opens (or switches between create/edit).
  useEffect(() => {
    if (open) {
      setForm(formFor(instance));
      setError(null);
    }
  }, [open, instance]);

  if (!open) return null;

  const editingId = instance?.id ?? null;

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
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="mt-10 w-full max-w-xl rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900 sm:mt-0"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-semibold">{editingId ? "Edit event" : "New event"}</h2>

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

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
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
