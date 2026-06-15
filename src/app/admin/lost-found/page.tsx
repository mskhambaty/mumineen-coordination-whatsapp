"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type ReportType = "lost" | "found";
type StatusTab = "open" | "resolved";

type LostFoundReport = {
  id: string;
  report_type: ReportType;
  status: "open" | "resolved";
  item_name: string;
  description: string | null;
  category: string | null;
  color: string | null;
  brand: string | null;
  location: string | null;
  occurred_at: string | null;
  reporter_name: string | null;
  reporter_phone_e164: string;
  reporter_its: string | null;
  escalation_status: "not_required" | "pending" | "failed";
  escalated_at: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolved_notes: string | null;
  created_at: string;
};

function formatDate(value: string | null): string {
  if (!value) return "Not provided";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Add / Edit Modal
// ---------------------------------------------------------------------------
type FormData = {
  report_type: ReportType;
  item_name: string;
  description: string;
  category: string;
  color: string;
  brand: string;
  location: string;
  reporter_name: string;
  reporter_its: string;
};

const emptyForm: FormData = {
  report_type: "lost",
  item_name: "",
  description: "",
  category: "",
  color: "",
  brand: "",
  location: "",
  reporter_name: "",
  reporter_its: "",
};

function FormModal({
  initial,
  title,
  onClose,
  onSave,
}: {
  initial: FormData;
  title: string;
  onClose: () => void;
  onSave: (data: FormData) => Promise<void>;
}) {
  const [form, setForm] = useState<FormData>(initial);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        <div className="grid gap-3">
          <label className="text-sm font-medium">
            Type
            <select
              value={form.report_type}
              onChange={(e) => setForm({ ...form, report_type: e.target.value as ReportType })}
              className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="lost">Lost</option>
              <option value="found">Found</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Item Name *
            <input
              required
              minLength={2}
              maxLength={160}
              value={form.item_name}
              onChange={(e) => setForm({ ...form, item_name: e.target.value })}
              className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
          <label className="text-sm font-medium">
            Description
            <textarea
              rows={2}
              maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Category
              <input
                maxLength={120}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
            <label className="text-sm font-medium">
              Color
              <input
                maxLength={120}
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Brand
              <input
                maxLength={120}
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
            <label className="text-sm font-medium">
              Location
              <input
                maxLength={500}
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Reporter Name
              <input
                maxLength={200}
                value={form.reporter_name}
                onChange={(e) => setForm({ ...form, reporter_name: e.target.value })}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
            <label className="text-sm font-medium">
              Reporter ITS
              <input
                maxLength={40}
                value={form.reporter_its}
                onChange={(e) => setForm({ ...form, reporter_its: e.target.value })}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm dark:border-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolve Modal
// ---------------------------------------------------------------------------
function ResolveModal({
  report,
  onClose,
  onResolve,
}: {
  report: LostFoundReport;
  onClose: () => void;
  onResolve: (id: string, notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onResolve(report.id, notes);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <h2 className="mb-2 text-lg font-bold">Mark as Found / Returned</h2>
        <p className="mb-4 text-sm text-gray-500">
          Closing &quot;{report.item_name}&quot; — this will appear in the resolved history.
        </p>
        <label className="text-sm font-medium">
          Notes (optional)
          <textarea
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Returned to owner at help desk 2"
            className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm dark:border-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Resolving..." : "Resolve"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report Card
// ---------------------------------------------------------------------------
function ReportCard({
  report,
  onEdit,
  onDelete,
  onResolve,
}: {
  report: LostFoundReport;
  onEdit: (r: LostFoundReport) => void;
  onDelete: (r: LostFoundReport) => void;
  onResolve: (r: LostFoundReport) => void;
}) {
  const details = [
    report.category ? `Category: ${report.category}` : null,
    report.color ? `Color: ${report.color}` : null,
    report.brand ? `Brand: ${report.brand}` : null,
  ].filter(Boolean);

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              report.report_type === "lost"
                ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
            }`}>
              {report.report_type === "lost" ? "Lost" : "Found"}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              report.status === "resolved"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            }`}>
              {report.status}
            </span>
            {report.report_type === "lost" && report.status === "open" && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                report.escalation_status === "pending"
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}>
                Escalation: {report.escalation_status}
              </span>
            )}
          </div>
          <h2 className="text-lg font-semibold text-gray-950 dark:text-white">{report.item_name}</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Reported {formatDate(report.created_at)}</p>
        </div>
        {report.status === "open" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onResolve(report)}
              className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 dark:bg-green-950 dark:text-green-300"
            >
              Mark Resolved
            </button>
            <button
              type="button"
              onClick={() => onEdit(report)}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(report)}
              className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-300"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {report.description && <p className="mt-4 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">{report.description}</p>}
      {details.length > 0 && <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{details.join(" · ")}</p>}

      <dl className="mt-5 grid gap-3 border-t border-gray-100 pt-4 text-sm dark:border-gray-800 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase text-gray-400">Location</dt>
          <dd className="mt-1 text-gray-800 dark:text-gray-200">{report.location ?? "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-gray-400">Lost / Found At</dt>
          <dd className="mt-1 text-gray-800 dark:text-gray-200">{formatDate(report.occurred_at)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-gray-400">Reporter</dt>
          <dd className="mt-1 text-gray-800 dark:text-gray-200">{report.reporter_name ?? "Name not provided"}</dd>
          <dd className="text-gray-500 dark:text-gray-400">ITS: {report.reporter_its ?? "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-gray-400">Phone</dt>
          <dd className="mt-1 font-mono text-gray-800 dark:text-gray-200">
            {report.reporter_phone_e164 === "portal" ? "Added via portal" : report.reporter_phone_e164}
          </dd>
        </div>
      </dl>

      {report.status === "resolved" && (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Resolved by {report.resolved_by_name ?? "Unknown"} on {formatDate(report.resolved_at)}
          </p>
          {report.resolved_notes && (
            <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">{report.resolved_notes}</p>
          )}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function LostFoundPage() {
  const router = useRouter();
  const [reports, setReports] = useState<LostFoundReport[]>([]);
  const [type, setType] = useState<"all" | ReportType>("all");
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editReport, setEditReport] = useState<LostFoundReport | null>(null);
  const [resolveReport, setResolveReport] = useState<LostFoundReport | null>(null);

  const loadReports = useCallback(async () => {
    const response = await apiFetch("/api/admin/lost-found");
    const body = await response.json().catch(() => ({})) as { reports?: LostFoundReport[]; error?: string };
    if (response.ok) setReports(body.reports ?? []);
    else setError(body.error ?? "Could not load lost-and-found reports");
    setLoading(false);
  }, []);

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
    void loadReports();
  }, [router, loadReports]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return reports.filter((report) => {
      if (report.status !== statusTab) return false;
      if (type !== "all" && report.report_type !== type) return false;
      if (!normalized) return true;
      return [
        report.item_name,
        report.description,
        report.category,
        report.color,
        report.brand,
        report.location,
        report.reporter_name,
        report.reporter_phone_e164,
        report.reporter_its,
      ].some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [query, reports, type, statusTab]);

  const openCount = reports.filter((r) => r.status === "open").length;
  const resolvedCount = reports.filter((r) => r.status === "resolved").length;
  const lostCount = reports.filter((r) => r.report_type === "lost" && r.status === statusTab).length;
  const foundCount = reports.filter((r) => r.report_type === "found" && r.status === statusTab).length;

  // Handlers
  const handleCreate = async (data: FormData) => {
    const res = await apiFetch("/api/admin/lost-found", {
      method: "POST",
      body: JSON.stringify({
        report_type: data.report_type,
        item_name: data.item_name,
        description: data.description || undefined,
        category: data.category || undefined,
        color: data.color || undefined,
        brand: data.brand || undefined,
        location: data.location || undefined,
        reporter_name: data.reporter_name || undefined,
        reporter_its: data.reporter_its || undefined,
      }),
    });
    if (res.ok) {
      setShowAddModal(false);
      await loadReports();
    }
  };

  const handleEdit = async (data: FormData) => {
    if (!editReport) return;
    const res = await apiFetch(`/api/admin/lost-found/${editReport.id}`, {
      method: "PUT",
      body: JSON.stringify({
        item_name: data.item_name,
        description: data.description || null,
        category: data.category || null,
        color: data.color || null,
        brand: data.brand || null,
        location: data.location || null,
        reporter_name: data.reporter_name || null,
        reporter_its: data.reporter_its || null,
      }),
    });
    if (res.ok) {
      setEditReport(null);
      await loadReports();
    }
  };

  const handleDelete = async (report: LostFoundReport) => {
    if (!confirm(`Delete "${report.item_name}"? This cannot be undone.`)) return;
    const res = await apiFetch(`/api/admin/lost-found/${report.id}`, { method: "DELETE" });
    if (res.ok) await loadReports();
  };

  const handleResolve = async (id: string, notes: string) => {
    const res = await apiFetch(`/api/admin/lost-found/${id}/resolve`, {
      method: "PATCH",
      body: JSON.stringify({ notes: notes || undefined }),
    });
    if (res.ok) {
      setResolveReport(null);
      await loadReports();
    }
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lost &amp; Found</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Track lost and found items. Drop-off and pickup are at any help desk in the masjid complex.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add Item
        </button>
      </div>

      {/* Status tabs */}
      <div className="mt-6 flex items-center gap-4 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setStatusTab("open")}
          className={`border-b-2 px-4 py-2 text-sm font-medium ${
            statusTab === "open"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Open ({openCount})
        </button>
        <button
          type="button"
          onClick={() => setStatusTab("resolved")}
          className={`border-b-2 px-4 py-2 text-sm font-medium ${
            statusTab === "resolved"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Resolved ({resolvedCount})
        </button>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900">
          {(["all", "lost", "found"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize ${
                type === value ? "bg-blue-600 text-white" : "text-gray-600 dark:text-gray-300"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="flex gap-3 text-sm">
          <span className="rounded-lg bg-red-50 px-3 py-2 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">{lostCount} lost</span>
          <span className="rounded-lg bg-green-50 px-3 py-2 font-medium text-green-700 dark:bg-green-950 dark:text-green-300">{foundCount} found</span>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search item, location, reporter, ITS, phone..."
          className="min-w-72 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {loading && <p className="mt-8 text-sm text-gray-500">Loading reports...</p>}
      {error && <p className="mt-8 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="mt-8 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">
          {statusTab === "resolved"
            ? "No resolved items yet."
            : "No matching lost-and-found reports."}
        </p>
      )}
      <section className="mt-6 space-y-4">
        {filtered.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            onEdit={setEditReport}
            onDelete={handleDelete}
            onResolve={setResolveReport}
          />
        ))}
      </section>

      {/* Modals */}
      {showAddModal && (
        <FormModal
          title="Add Lost or Found Item"
          initial={emptyForm}
          onClose={() => setShowAddModal(false)}
          onSave={handleCreate}
        />
      )}
      {editReport && (
        <FormModal
          title={`Edit: ${editReport.item_name}`}
          initial={{
            report_type: editReport.report_type,
            item_name: editReport.item_name,
            description: editReport.description ?? "",
            category: editReport.category ?? "",
            color: editReport.color ?? "",
            brand: editReport.brand ?? "",
            location: editReport.location ?? "",
            reporter_name: editReport.reporter_name ?? "",
            reporter_its: editReport.reporter_its ?? "",
          }}
          onClose={() => setEditReport(null)}
          onSave={handleEdit}
        />
      )}
      {resolveReport && (
        <ResolveModal
          report={resolveReport}
          onClose={() => setResolveReport(null)}
          onResolve={handleResolve}
        />
      )}
    </main>
  );
}
