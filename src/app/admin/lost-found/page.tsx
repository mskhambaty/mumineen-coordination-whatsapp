"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type ReportType = "lost" | "found";

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

function ReportCard({ report }: { report: LostFoundReport }) {
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
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {report.status}
            </span>
            {report.report_type === "lost" && (
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
          <dd className="mt-1 font-mono text-gray-800 dark:text-gray-200">{report.reporter_phone_e164}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function LostFoundPage() {
  const router = useRouter();
  const [reports, setReports] = useState<LostFoundReport[]>([]);
  const [type, setType] = useState<"all" | ReportType>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    void (async () => {
      const response = await apiFetch("/api/admin/lost-found");
      const body = await response.json().catch(() => ({})) as { reports?: LostFoundReport[]; error?: string };
      if (response.ok) setReports(body.reports ?? []);
      else setError(body.error ?? "Could not load lost-and-found reports");
      setLoading(false);
    })();
  }, [router]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return reports.filter((report) => {
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
  }, [query, reports, type]);

  const lostCount = reports.filter((report) => report.report_type === "lost").length;
  const foundCount = reports.filter((report) => report.report_type === "found").length;

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lost &amp; Found</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Reports submitted through the WhatsApp assistant. Drop-off and pickup are at any help desk in the masjid complex.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <span className="rounded-lg bg-red-50 px-3 py-2 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">{lostCount} lost</span>
          <span className="rounded-lg bg-green-50 px-3 py-2 font-medium text-green-700 dark:bg-green-950 dark:text-green-300">{foundCount} found</span>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
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
          No matching lost-and-found reports.
        </p>
      )}
      <section className="mt-6 space-y-4">
        {filtered.map((report) => <ReportCard key={report.id} report={report} />)}
      </section>
    </main>
  );
}
