"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Tally = { responded_families: number; yes_count: number; total_head_count: number };

type MealGridSlot = {
  eventDate: string;
  meal: "lunch" | "dinner";
  servingType: string | null;
  respondedFamilies: number;
  attendingFamilies: number;
  totalHeadCount: number;
};

type NiyazInstance = {
  id: string;
  title: string;
  status: "draft" | "open" | "closed";
  event_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  description: string | null;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  updated_at: string;
  tally?: Tally;
};

type ResponseRow = {
  id: string;
  family_id: string;
  submitted_by_mumin_id: string | null;
  response: "yes" | "no" | "maybe" | null;
  head_count: number | null;
  responded_by_phone: string | null;
  source: string;
  recorded_by: string | null;
  submitted_at: string;
  created_at: string;
  family: { hof_its: string | null } | null;
  submitter: { its: string | null; full_name: string | null } | null;
};

type InstanceForm = {
  title: string;
  event_at: string;
  venue_name: string;
  venue_address: string;
  description: string;
  status: "draft" | "open" | "closed";
  opens_at: string;
  closes_at: string;
};

const emptyInstanceForm: InstanceForm = {
  title: "",
  event_at: "",
  venue_name: "",
  venue_address: "",
  description: "",
  status: "draft",
  opens_at: "",
  closes_at: "",
};

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function NiyazPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [instances, setInstances] = useState<NiyazInstance[]>([]);
  const [selected, setSelected] = useState<NiyazInstance | null>(null);

  const [showInstanceForm, setShowInstanceForm] = useState(false);
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [instanceForm, setInstanceForm] = useState<InstanceForm>(emptyInstanceForm);
  const [savingInstance, setSavingInstance] = useState(false);

  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [respTally, setRespTally] = useState<Tally | null>(null);
  const [respForm, setRespForm] = useState({ hof_its: "", submitted_by_its: "", response: "yes" as "yes" | "no" | "maybe", head_count: "" });
  const [savingResp, setSavingResp] = useState(false);
  const [editingRespId, setEditingRespId] = useState<string | null>(null);
  const [editResp, setEditResp] = useState({ response: "yes" as "yes" | "no" | "maybe", head_count: "" });
  const [mealGrid, setMealGrid] = useState<MealGridSlot[]>([]);

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
    void loadInstances();
    void loadMealGrid();
  }, [router]);

  async function loadMealGrid() {
    const res = await apiFetch("/api/admin/niyaz/meal-grid");
    if (res.ok) setMealGrid(((await res.json()).slots as MealGridSlot[]) ?? []);
  }

  // The signed-in admin, read at submit time (stored on the response as recorded_by).
  function currentAdminId(): string {
    try {
      const u = JSON.parse(localStorage.getItem("admin_user") ?? "null") as { email?: string; its?: string; name?: string } | null;
      return u?.email ?? u?.its ?? u?.name ?? "admin";
    } catch {
      return "admin";
    }
  }

  async function loadInstances() {
    const res = await apiFetch("/api/admin/niyaz/instances");
    if (res.ok) setInstances(((await res.json()).instances as NiyazInstance[]) ?? []);
  }

  async function loadResponses(instanceId: string) {
    const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/responses`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setResponses((data.responses as ResponseRow[]) ?? []);
      setRespTally((data.tally as Tally) ?? null);
    }
  }

  function selectInstance(c: NiyazInstance) {
    setSelected(c);
    setEditingRespId(null);
    void loadResponses(c.id);
  }

  function openCreate() {
    setEditingInstanceId(null);
    setInstanceForm(emptyInstanceForm);
    setShowInstanceForm(true);
  }

  function openEdit(c: NiyazInstance) {
    setEditingInstanceId(c.id);
    setInstanceForm({
      title: c.title,
      event_at: toLocalInput(c.event_at),
      venue_name: c.venue_name ?? "",
      venue_address: c.venue_address ?? "",
      description: c.description ?? "",
      status: c.status,
      opens_at: toLocalInput(c.opens_at),
      closes_at: toLocalInput(c.closes_at),
    });
    setShowInstanceForm(true);
  }

  async function saveInstance() {
    if (!instanceForm.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSavingInstance(true);
    setError(null);
    try {
      const payload = {
        title: instanceForm.title,
        event_at: localToIso(instanceForm.event_at),
        venue_name: instanceForm.venue_name,
        venue_address: instanceForm.venue_address,
        description: instanceForm.description,
        status: instanceForm.status,
        opens_at: localToIso(instanceForm.opens_at),
        closes_at: localToIso(instanceForm.closes_at),
      };
      const url = editingInstanceId ? `/api/admin/niyaz/instances/${editingInstanceId}` : "/api/admin/niyaz/instances";
      const res = await apiFetch(url, {
        method: editingInstanceId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setShowInstanceForm(false);
      await loadInstances();
      if (editingInstanceId && selected?.id === editingInstanceId) setSelected((data.instance as NiyazInstance) ?? selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingInstance(false);
    }
  }

  async function changeStatus(c: NiyazInstance, status: NiyazInstance["status"]) {
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/niyaz/instances/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Status update failed");
      await loadInstances();
      if (selected?.id === c.id) setSelected({ ...selected, status });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    }
  }

  async function addResponse() {
    if (!selected) return;
    if (!respForm.hof_its.trim()) {
      setError("Enter the family's HOF ITS.");
      return;
    }
    setSavingResp(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/niyaz/responses", {
        method: "POST",
        body: JSON.stringify({
          registration_instance_id: selected.id,
          hof_its: respForm.hof_its.trim(),
          submitted_by_its: respForm.submitted_by_its.trim() || undefined,
          response: respForm.response,
          head_count: respForm.head_count === "" ? null : Number(respForm.head_count),
          recorded_by: currentAdminId(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to record response");
      setRespForm({ hof_its: "", submitted_by_its: "", response: "yes", head_count: "" });
      await loadResponses(selected.id);
      await loadInstances();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record response");
    } finally {
      setSavingResp(false);
    }
  }

  function startEditResp(r: ResponseRow) {
    setEditingRespId(r.id);
    setEditResp({ response: (r.response ?? "yes") as "yes" | "no" | "maybe", head_count: r.head_count == null ? "" : String(r.head_count) });
  }

  async function saveEditResp(id: string) {
    if (!selected) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/niyaz/responses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ response: editResp.response, head_count: editResp.head_count === "" ? null : Number(editResp.head_count) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Update failed");
      setEditingRespId(null);
      await loadResponses(selected.id);
      await loadInstances();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function deleteResp(id: string) {
    if (!selected || !window.confirm("Delete this response?")) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/niyaz/responses/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Delete failed");
      await loadResponses(selected.id);
      await loadInstances();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const statusBadge = (s: NiyazInstance["status"]) =>
    s === "open"
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
      : s === "closed"
        ? "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Niyaz Registration</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Create Niyaz events and record per-family RSVPs.</p>
        </div>
        <button type="button" onClick={openCreate} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          New Niyaz
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {mealGrid.length > 0 && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Meal counts (kitchen) — attending families · head count</h2>
            <button type="button" onClick={loadMealGrid} className="text-xs text-blue-600">Refresh</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-2 py-1">Day</th>
                  <th className="px-2 py-1">Lunch (thaal)</th>
                  <th className="px-2 py-1">Dinner (packets)</th>
                </tr>
              </thead>
              <tbody>
                {[...new Set(mealGrid.map((s) => s.eventDate))].sort().map((date) => {
                  const lunch = mealGrid.find((s) => s.eventDate === date && s.meal === "lunch");
                  const dinner = mealGrid.find((s) => s.eventDate === date && s.meal === "dinner");
                  const cell = (s?: MealGridSlot) =>
                    s ? `${s.attendingFamilies} fam · ${s.totalHeadCount}` : "—";
                  return (
                    <tr key={date} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1 font-medium">{new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</td>
                      <td className="px-2 py-1">{cell(lunch)}</td>
                      <td className="px-2 py-1">{cell(dinner)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-300 font-semibold dark:border-gray-700">
                  <td className="px-2 py-1">Total head count</td>
                  <td className="px-2 py-1">{mealGrid.filter((s) => s.meal === "lunch").reduce((n, s) => n + s.totalHeadCount, 0)}</td>
                  <td className="px-2 py-1">{mealGrid.filter((s) => s.meal === "dinner").reduce((n, s) => n + s.totalHeadCount, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {showInstanceForm && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-lg font-semibold">{editingInstanceId ? "Edit Niyaz" : "New Niyaz"}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-xs uppercase tracking-wide text-gray-400">Title
              <input value={instanceForm.title} onChange={(e) => setInstanceForm({ ...instanceForm, title: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Event date & time
              <input type="datetime-local" value={instanceForm.event_at} onChange={(e) => setInstanceForm({ ...instanceForm, event_at: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Status
              <select value={instanceForm.status} onChange={(e) => setInstanceForm({ ...instanceForm, status: e.target.value as NiyazInstance["status"] })} className={inputCls}>
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Venue name
              <input value={instanceForm.venue_name} onChange={(e) => setInstanceForm({ ...instanceForm, venue_name: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Venue address
              <input value={instanceForm.venue_address} onChange={(e) => setInstanceForm({ ...instanceForm, venue_address: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">RSVP opens
              <input type="datetime-local" value={instanceForm.opens_at} onChange={(e) => setInstanceForm({ ...instanceForm, opens_at: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">RSVP closes
              <input type="datetime-local" value={instanceForm.closes_at} onChange={(e) => setInstanceForm({ ...instanceForm, closes_at: e.target.value })} className={inputCls} />
            </label>
            <label className="sm:col-span-2 text-xs uppercase tracking-wide text-gray-400">Description
              <textarea value={instanceForm.description} onChange={(e) => setInstanceForm({ ...instanceForm, description: e.target.value })} rows={2} className={inputCls} />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={saveInstance} disabled={savingInstance} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700">
              {savingInstance ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setShowInstanceForm(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-lg font-semibold">Niyaz events</h2>
        {instances.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No Niyaz events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-400">
                <tr>
                  <th className="px-2 py-1.5">Title</th>
                  <th className="px-2 py-1.5">Event</th>
                  <th className="px-2 py-1.5">Venue</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">RSVPs</th>
                  <th className="px-2 py-1.5">Heads</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {instances.map((c) => (
                  <tr
                    key={c.id}
                    className={`cursor-pointer border-t border-gray-100 dark:border-gray-800 ${selected?.id === c.id ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                    onClick={() => selectInstance(c)}
                  >
                    <td className="px-2 py-1.5 font-medium">{c.title}</td>
                    <td className="px-2 py-1.5">{fmtDateTime(c.event_at)}</td>
                    <td className="px-2 py-1.5">{c.venue_name ?? "—"}</td>
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={c.status}
                        onChange={(e) => changeStatus(c, e.target.value as NiyazInstance["status"])}
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusBadge(c.status)}`}
                      >
                        <option value="draft">draft</option>
                        <option value="open">open</option>
                        <option value="closed">closed</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">{c.tally?.responded_families ?? 0}</td>
                    <td className="px-2 py-1.5">{c.tally?.total_head_count ?? 0}</td>
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => openEdit(c)} className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
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
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">RSVPs — {selected.title}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {respTally?.responded_families ?? 0} responded · {respTally?.yes_count ?? 0} attending · {respTally?.total_head_count ?? 0} heads
            </p>
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
            <label className="text-xs uppercase tracking-wide text-gray-400">HOF ITS
              <input value={respForm.hof_its} onChange={(e) => setRespForm({ ...respForm, hof_its: e.target.value })} className={`${inputCls} w-32`} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Submitted by ITS (opt.)
              <input value={respForm.submitted_by_its} onChange={(e) => setRespForm({ ...respForm, submitted_by_its: e.target.value })} className={`${inputCls} w-32`} />
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Response
              <select value={respForm.response} onChange={(e) => setRespForm({ ...respForm, response: e.target.value as "yes" | "no" | "maybe" })} className={`${inputCls} w-24`}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="maybe">Maybe</option>
              </select>
            </label>
            <label className="text-xs uppercase tracking-wide text-gray-400">Head count
              <input type="number" min={0} value={respForm.head_count} onChange={(e) => setRespForm({ ...respForm, head_count: e.target.value })} className={`${inputCls} w-24`} />
            </label>
            <button type="button" onClick={addResponse} disabled={savingResp} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700">
              {savingResp ? "Saving…" : "Add / update"}
            </button>
          </div>

          {responses.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No responses yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-1.5">HOF ITS</th>
                    <th className="px-2 py-1.5">Submitted by</th>
                    <th className="px-2 py-1.5">Response</th>
                    <th className="px-2 py-1.5">Heads</th>
                    <th className="px-2 py-1.5">When</th>
                    <th className="px-2 py-1.5">Source</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1.5 font-mono text-xs">{r.family?.hof_its ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.submitter?.full_name ?? r.responded_by_phone ?? r.recorded_by ?? "—"}</td>
                      {editingRespId === r.id ? (
                        <>
                          <td className="px-2 py-1.5">
                            <select value={editResp.response} onChange={(e) => setEditResp({ ...editResp, response: e.target.value as "yes" | "no" | "maybe" })} className={`${inputCls} w-24`}>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                              <option value="maybe">Maybe</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" min={0} value={editResp.head_count} onChange={(e) => setEditResp({ ...editResp, head_count: e.target.value })} className={`${inputCls} w-20`} />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-1.5">
                            <span className={r.response === "yes" ? "text-green-600 dark:text-green-400" : r.response === "no" ? "text-red-500" : "text-gray-500"}>{r.response ?? "—"}</span>
                          </td>
                          <td className="px-2 py-1.5">{r.head_count ?? "—"}</td>
                        </>
                      )}
                      <td className="px-2 py-1.5 text-xs text-gray-500">{fmtDateTime(r.submitted_at)}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-500">{r.source}</td>
                      <td className="px-2 py-1.5">
                        {editingRespId === r.id ? (
                          <span className="flex gap-1">
                            <button type="button" onClick={() => saveEditResp(r.id)} className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700">Save</button>
                            <button type="button" onClick={() => setEditingRespId(null)} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">Cancel</button>
                          </span>
                        ) : (
                          <span className="flex gap-1">
                            <button type="button" onClick={() => startEditResp(r)} className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">Edit</button>
                            <button type="button" onClick={() => deleteResp(r.id)} className="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">Delete</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
