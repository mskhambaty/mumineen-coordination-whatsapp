"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import EventRsvpComposer from "@/components/admin/niyaz/EventRsvpComposer";

// Niyaz days = the day-level RSVP config (niyaz_event_config), prefilled for 1st–10th Moharram. Each
// day holds the event title, lunch/dinner menus, RSVP end time, which meals are offered, and the
// template, and is where the RSVP broadcast is configured and sent. (The Niyaz events page lists the
// per-meal registration instances and their responses.)

type Day = {
  date: string;
  title: string | null;
  lunch_menu: string | null;
  dinner_menu: string | null;
  rsvp_end_time: string | null;
  has_lunch: boolean;
  has_dinner: boolean;
  template_code: string | null;
  instance_id: string | null;
  instances: { id: string; title: string | null; meal: string | null; serving_type: string | null }[];
};

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function mealLabel(d: Day): string {
  if (d.has_lunch && d.has_dinner) return "Lunch + Dinner";
  if (d.has_lunch) return "Lunch";
  if (d.has_dinner) return "Dinner";
  return "—";
}

export default function NiyazDaysPage() {
  const router = useRouter();
  const [days, setDays] = useState<Day[]>([]);
  const [selected, setSelected] = useState<Day | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/admin/niyaz/days");
    if (res.ok) {
      const list = ((await res.json()).days as Day[]) ?? [];
      setDays(list);
      // Keep the selected day in sync after a save (meal badges etc.).
      setSelected((cur) => (cur ? list.find((d) => d.date === cur.date) ?? cur : cur));
    }
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
    void load();
  }, [router, load]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/admin/niyaz")}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            ← Niyaz events
          </button>
          <div>
            <h1 className="text-xl font-bold">Niyaz Days</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Configure each day and send its RSVP.</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {days.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No Niyaz days configured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-400">
                <tr>
                  <th className="px-2 py-1.5">Day</th>
                  <th className="px-2 py-1.5">Meals</th>
                  <th className="px-2 py-1.5">Template</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr
                    key={d.date}
                    onClick={() => setSelected(d)}
                    className={`cursor-pointer border-t border-gray-100 dark:border-gray-800 ${selected?.date === d.date ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{d.title || dayLabel(d.date)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{dayLabel(d.date)}</div>
                    </td>
                    <td className="px-2 py-1.5">{mealLabel(d)}</td>
                    <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{d.template_code ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                        {selected?.date === d.date ? "Editing" : "Configure"}
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
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-2 text-base font-semibold">Registration instances — {selected.title || dayLabel(selected.date)}</h2>
          {selected.instances.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No registration instances for this date. Create one on the{" "}
              <button type="button" onClick={() => router.push("/admin/niyaz")} className="text-blue-600 underline dark:text-blue-400">Niyaz events</button>{" "}
              page to enable sending.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
              {selected.instances.map((inst) => (
                <li key={inst.id} className="flex items-center gap-2 py-1.5">
                  <span className="font-medium">{inst.title || "Niyaz"}</span>
                  {inst.meal && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{inst.meal}</span>}
                  {inst.serving_type && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{inst.serving_type}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && (
        <EventRsvpComposer
          key={selected.date}
          date={selected.date}
          instanceId={selected.instance_id}
          title={selected.title || dayLabel(selected.date)}
          onSaved={load}
        />
      )}
    </main>
  );
}
