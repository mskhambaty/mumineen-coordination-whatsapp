"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";

type Summary = {
  department_id: string | null;
  department_name: string;
  ai_briefing: string | null;
  ai_briefing_short: string | null;
  metrics: unknown;
};

type Dept = { id: string; name: string };

function fmtDay(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function DepartmentDigestPage() {
  const [activeDate, setActiveDate] = useState<string>("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d?: string) => {
    setLoading(true);
    try {
      const qs = d ? `?date=${d}` : "";
      const res = await apiFetch(`/api/admin/department-digest${qs}`);
      if (res.ok) {
        const data = await res.json();
        setSummaries((data.summaries as Summary[]) ?? []);
        setAvailableDates((data.available_dates as string[]) ?? []);
        setDepartments((data.departments as Dept[]) ?? []);
        setActiveDate(data.date as string);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const allUp = summaries.find((s) => s.department_id === null);
  const deptCards = summaries.filter((s) => s.department_id !== null);
  const reportedIds = new Set(deptCards.map((s) => s.department_id));
  const noFeedbackDepts = departments.filter((d) => !reportedIds.has(d.id)).map((d) => d.name).sort();

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="text-xl font-bold">Daily Department Digest</h1>
      <p className="mt-1 text-sm text-gray-500">Nightly briefings — feedback &amp; issues per department, with next-day meal counts.</p>

      {/* Day tabs */}
      {availableDates.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
          {availableDates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => load(d)}
              className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${
                d === activeDate
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              {fmtDay(d)}
            </button>
          ))}
        </div>
      ) : (
        !loading && <div className="mt-4 text-gray-400">No digests have been generated yet.</div>
      )}

      {loading && <div className="mt-4 text-sm text-gray-400">Loading…</div>}

      <div className="mt-4 space-y-4">
        {allUp && (
          <div className="rounded-lg border-2 border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900 dark:bg-blue-950/30">
            <h2 className="font-semibold">{allUp.department_name}</h2>
            {allUp.ai_briefing_short && <p className="mt-1 text-sm italic text-gray-600 dark:text-gray-300">{allUp.ai_briefing_short}</p>}
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{allUp.ai_briefing || "(no briefing)"}</pre>
          </div>
        )}

        {deptCards.map((s) => (
          <div key={s.department_id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <h2 className="font-semibold">{s.department_name}</h2>
            {s.ai_briefing_short && (
              <p className="mt-1 rounded-md bg-gray-50 px-3 py-2 text-sm italic text-gray-600 dark:bg-gray-900 dark:text-gray-300">{s.ai_briefing_short}</p>
            )}
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{s.ai_briefing || "(no briefing)"}</pre>
          </div>
        ))}

        {availableDates.length > 0 && noFeedbackDepts.length > 0 && (
          <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800">
            <span className="font-medium text-gray-600 dark:text-gray-400">No feedback this day:</span>{" "}
            {noFeedbackDepts.join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
