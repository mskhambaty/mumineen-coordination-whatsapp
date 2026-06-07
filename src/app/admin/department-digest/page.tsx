"use client";

import { useCallback, useEffect, useState } from "react";

type Summary = {
  department_id: string | null;
  department_name: string;
  ai_briefing: string | null;
  metrics: unknown;
};

export default function DepartmentDigestPage() {
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";
  const [date, setDate] = useState<string>("");
  const [activeDate, setActiveDate] = useState<string>("");
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (d?: string) => {
      setLoading(true);
      try {
        const qs = d ? `?date=${d}` : "";
        const res = await fetch(`/api/admin/department-digest${qs}`, { headers: { "x-admin-key": adminKey } });
        if (res.ok) {
          const data = await res.json();
          setSummaries((data.summaries as Summary[]) ?? []);
          setActiveDate(data.date as string);
          setDate(data.date as string);
        }
      } finally {
        setLoading(false);
      }
    },
    [adminKey],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="text-xl font-bold">Daily Department Digest</h1>
      <p className="mt-1 text-sm text-gray-500">Stored nightly briefings — feedback, issues, escalations, and next-day meal counts.</p>

      <div className="mt-4 flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button type="button" onClick={() => load(date)} className="rounded-md border border-gray-300 px-3 py-1 text-sm dark:border-gray-700">
          View
        </button>
        {loading && <span className="text-sm text-gray-400">Loading…</span>}
      </div>

      {activeDate && <div className="mt-4 text-sm text-gray-400">Showing {activeDate}</div>}

      <div className="mt-3 space-y-4">
        {summaries.map((s) => (
          <div key={s.department_id ?? "allup"} className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <h2 className="font-semibold">{s.department_name}</h2>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{s.ai_briefing || "(no briefing generated)"}</pre>
          </div>
        ))}
        {!loading && summaries.length === 0 && <div className="text-gray-400">No briefings stored for this day yet.</div>}
      </div>
    </div>
  );
}
