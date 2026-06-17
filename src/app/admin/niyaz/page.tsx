"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import EventFormModal, { type EditableInstance } from "@/components/admin/niyaz/EventFormModal";
import { groupTalliesByDay } from "@/lib/rsvp/niyaz-day-grouping";

type Meal = "lunch" | "dinner";
type ServingType = "thaal" | "packet";
type TallyMode = "max" | "min";

// One Niyaz event with its per-event attendance tallies (from the niyaz_event_tallies view).
type NiyazEvent = {
  id: string;
  title: string;
  eventDate: string; // YYYY-MM-DD
  hijriDate: string | null;
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
  unregAdults: number;
  unregKids: number;
  headcountHeads: number;
  rsvpCount: number;
};

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function yesOf(e: NiyazEvent): number {
  return e.yesAdults + e.yesKids;
}

function toEditable(e: NiyazEvent): EditableInstance {
  return { id: e.id, title: e.title, eventDate: e.eventDate, hijriDate: e.hijriDate, meal: e.meal, servingType: e.servingType, description: e.description };
}

export default function NiyazPage() {
  const router = useRouter();

  const [mode, setMode] = useState<TallyMode>("min");
  const [events, setEvents] = useState<NiyazEvent[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Edit/create modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EditableInstance | null>(null);

  const days = useMemo(() => groupTalliesByDay(events), [events]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadEvents(m: TallyMode = mode) {
    const res = await apiFetch(`/api/admin/niyaz/instances?mode=${m}`);
    if (res.ok) setEvents(((await res.json()).instances as NiyazEvent[]) ?? []);
  }

  function switchMode(m: TallyMode) {
    setMode(m);
    void loadEvents(m);
  }

  function toggleDay(date: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(e: NiyazEvent) {
    setEditing(toEditable(e));
    setModalOpen(true);
  }

  // Compact per-meal Yes hint for the collapsed day row (e.g. "Lunch 33 · Dinner 33").
  function mealHint(dayEvents: NiyazEvent[]): string {
    return dayEvents
      .map((e) => `${e.meal ? e.meal[0].toUpperCase() + e.meal.slice(1) : "Meal"} ${yesOf(e)}`)
      .join(" · ");
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Niyaz Days</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Expand a day to see its jaman and counts. Click a jaman for its RSVP responses; use Send RSVP to configure and broadcast.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/admin/conversations?scope=niyaz")}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Niyaz inbox →
          </button>
          <button type="button" onClick={openCreate} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            New event
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Days</h2>
          <div className="flex gap-1 rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
            <button
              type="button"
              onClick={() => switchMode("max")}
              className={`rounded px-3 py-1 text-xs font-medium ${mode === "max" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
              title="All registered members assumed attending from arrival date"
            >
              Max
            </button>
            <button
              type="button"
              onClick={() => switchMode("min")}
              className={`rounded px-3 py-1 text-xs font-medium ${mode === "min" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
              title="Only members who actively confirmed via WhatsApp or admin"
            >
              Min
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {mode === "max" ? (
            <>
              <span className="font-semibold text-gray-700 dark:text-gray-200">Max (kitchen-planning upper bound):</span>{" "}
              every registered member is counted as attending from their arrival date, then adjusted by any WhatsApp or
              admin changes. Use this to prepare enough food.
            </>
          ) : (
            <>
              <span className="font-semibold text-gray-700 dark:text-gray-200">Min (confirmed only):</span>{" "}
              counts only members who interacted via WhatsApp or were set by an admin — arrival-date defaults are excluded.
              Viewing your RSVP via the bot counts as confirmation. Use this to see who has actively confirmed.
            </>
          )}{" "}
          Yes count = attending heads (adults + kids).
        </p>

        {days.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No Niyaz days yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {days.map((day) => {
              const isOpen = expanded.has(day.date);
              return (
                <div key={day.date}>
                  {/* Day row */}
                  <div
                    onClick={() => toggleDay(day.date)}
                    className="flex cursor-pointer items-center gap-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <span className="w-4 text-gray-400" aria-hidden>{isOpen ? "▾" : "▸"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{day.title || dayLabel(day.date)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {dayLabel(day.date)} · {mealHint(day.events)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        router.push(`/admin/niyaz/days?date=${day.date}`);
                      }}
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Send RSVP →
                    </button>
                  </div>

                  {/* Expanded jaman (per-meal events) */}
                  {isOpen && (
                    <div className="mb-2 ml-7 overflow-x-auto rounded-md border border-gray-100 dark:border-gray-800">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase text-gray-400">
                          <tr>
                            <th className="px-3 py-1.5">Jaman</th>
                            <th className="px-3 py-1.5 text-right">Yes count</th>
                            <th className="px-3 py-1.5"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {day.events.map((e) => (
                            <tr
                              key={e.id}
                              onClick={() => router.push(`/admin/niyaz/events/${e.id}`)}
                              className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                            >
                              <td className="px-3 py-1.5">
                                <span className="font-medium capitalize">{e.meal ?? "—"}</span>
                                {e.servingType ? <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">· {e.servingType}</span> : null}
                              </td>
                              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{yesOf(e)}</td>
                              <td className="px-3 py-1.5 text-right" onClick={(ev) => ev.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => openEdit(e)}
                                  className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                                >
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
              );
            })}
          </div>
        )}
      </div>

      <EventFormModal
        open={modalOpen}
        instance={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => loadEvents()}
      />
    </main>
  );
}
