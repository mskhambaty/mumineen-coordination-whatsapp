"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

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

type UnregRow = {
  id: string;
  phone_e164: string;
  attending: boolean;
  adults: number;
  kids: number;
  its_number: string | null;
  source: string;
  created_at: string;
};

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

type Instance = {
  id: string;
  title: string | null;
  event_date: string | null;
  hijri_date: string | null;
  meal: string | null;
  serving_type: string | null;
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

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

function dayLabel(date: string | null): string {
  if (!date) return "—";
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function NiyazEventPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [instance, setInstance] = useState<Instance | null>(null);
  const [responses, setResponses] = useState<RespRow[]>([]);
  const [unregResponses, setUnregResponses] = useState<UnregRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [respSearch, setRespSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (instanceId: string) => {
    const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/responses`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to load event.");
      setLoaded(true);
      return;
    }
    setInstance((data.instance as Instance) ?? null);
    setResponses((data.responses as RespRow[]) ?? []);
    setUnregResponses((data.unregistered as UnregRow[]) ?? []);
    setSummary((data.summary as Summary) ?? null);
    setLoaded(true);
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
    if (id) void load(id);
  }, [router, id, load]);

  const q = respSearch.trim().toLowerCase();
  const filteredResponses = q
    ? responses.filter(
        (r) =>
          (r.mumin?.full_name ?? "").toLowerCase().includes(q) ||
          (r.mumin?.its ?? "").toLowerCase().includes(q) ||
          (r.family?.hof_its ?? "").toLowerCase().includes(q) ||
          (r.responded_by_phone ?? "").toLowerCase().includes(q),
      )
    : responses;
  const filteredUnreg = q
    ? unregResponses.filter((u) => u.phone_e164.toLowerCase().includes(q) || (u.its_number ?? "").toLowerCase().includes(q))
    : unregResponses;

  // Yes/No headline. Yes includes attending unregistered guests; No is registered not-attending.
  const unregYes = unregResponses.filter((u) => u.attending).reduce((n, u) => n + u.adults + u.kids, 0);
  const yesCount = summary ? summary.yes_adults + summary.yes_kids + unregYes : 0;
  const noCount = summary ? summary.no_adults + summary.no_kids : 0;

  const title = instance?.title || dayLabel(instance?.event_date ?? null);
  const subtitle = [dayLabel(instance?.event_date ?? null), instance?.meal, instance?.serving_type].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/admin/niyaz")}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          ← Niyaz
        </button>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {!error && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:max-w-md">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-400">Yes count</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-green-600 dark:text-green-400">{yesCount}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs uppercase tracking-wide text-gray-400">No count</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-red-500">{noCount}</div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-lg font-semibold">RSVP responses</h2>

            {(responses.length > 0 || unregResponses.length > 0) && (
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="search"
                  value={respSearch}
                  onChange={(e) => setRespSearch(e.target.value)}
                  placeholder="Search by name, ITS, or phone…"
                  className={`${inputCls} max-w-xs`}
                />
                {q && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {filteredResponses.length + filteredUnreg.length} of {responses.length + unregResponses.length}
                  </span>
                )}
              </div>
            )}

            {!loaded ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : responses.length === 0 && unregResponses.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No responses yet.</p>
            ) : (
              <>
                {filteredResponses.length === 0 && filteredUnreg.length === 0 && q ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No responses match &quot;{respSearch}&quot;.</p>
                ) : null}

                {filteredResponses.length > 0 && (
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-white text-xs uppercase text-gray-400 dark:bg-gray-900">
                        <tr>
                          <th className="px-2 py-1.5">Name</th>
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

                {filteredUnreg.length > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Unregistered guests ({filteredUnreg.length})</h3>
                    <div className="max-h-60 overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-white text-xs uppercase text-gray-400 dark:bg-gray-900">
                          <tr>
                            <th className="px-2 py-1.5">Phone</th>
                            <th className="px-2 py-1.5">RSVP</th>
                            <th className="px-2 py-1.5">Adults</th>
                            <th className="px-2 py-1.5">Kids</th>
                            <th className="px-2 py-1.5">ITS</th>
                            <th className="px-2 py-1.5">When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredUnreg.map((u) => (
                            <tr key={u.id} className="border-t border-gray-100 dark:border-gray-800">
                              <td className="px-2 py-1.5 font-mono text-xs">{u.phone_e164}</td>
                              <td className="px-2 py-1.5">
                                <span className={u.attending ? "text-green-600 dark:text-green-400" : "text-red-500"}>{u.attending ? "Yes" : "No"}</span>
                              </td>
                              <td className="px-2 py-1.5 tabular-nums">{u.adults}</td>
                              <td className="px-2 py-1.5 tabular-nums">{u.kids}</td>
                              <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{u.its_number ?? "—"}</td>
                              <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(u.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
