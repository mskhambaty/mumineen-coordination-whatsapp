"use client";

import { useState } from "react";

type Member = {
  its: string;
  full_name: string | null;
  gender: string | null;
  age: number | null;
  is_adult: boolean;
  is_head: boolean;
  whatsapp_e164: string | null;
  email: string | null;
  arrival_at: string | null;
  arrival_flight_no: string | null;
  departure_at: string | null;
  departure_flight_no: string | null;
  rahat_seating: boolean;
  wheelchair: boolean;
  special_needs: string | null;
};

type Family = {
  hof_its: string;
  registration_status: string;
  acc_type: string | null;
  hotel_name: string | null;
  hotel_address: string | null;
  utaro_host_name: string | null;
  utaro_host_its: string | null;
  utaro_host_address: string | null;
  utaro_host_whatsapp_e164: string | null;
  utaro_host_email: string | null;
  transport_mode: string | null;
  transport_detail: string | null;
};

const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

export default function RegisterPage() {
  const [hofInput, setHofInput] = useState("");
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [acc, setAcc] = useState<Partial<Family>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function findFamily(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/register?hof=${encodeURIComponent(hofInput.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not find your family");
      setFamily(data.family as Family);
      setAcc(data.family as Family);
      setMembers(
        (data.members as Member[]).map((m) => ({
          ...m,
          arrival_at: toLocalInput(m.arrival_at),
          departure_at: toLocalInput(m.departure_at),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not find your family");
    } finally {
      setLoading(false);
    }
  }

  function setMember(its: string, patch: Partial<Member>) {
    setMembers((prev) => prev.map((m) => (m.its === its ? { ...m, ...patch } : m)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!family) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hof_its: family.hof_its,
          submitted_by_its: members[0]?.its ?? null,
          members,
          accommodation: {
            acc_type: acc.acc_type,
            hotel_name: acc.hotel_name,
            hotel_address: acc.hotel_address,
            utaro_host_name: acc.utaro_host_name,
            utaro_host_its: acc.utaro_host_its,
            utaro_host_address: acc.utaro_host_address,
            utaro_host_whatsapp_e164: acc.utaro_host_whatsapp_e164,
            utaro_host_email: acc.utaro_host_email,
          },
          transport: { transport_mode: acc.transport_mode, transport_detail: acc.transport_detail },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not submit");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
        <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-md dark:bg-gray-900">
          <h1 className="text-2xl font-bold text-green-700 dark:text-green-400">Registration received</h1>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Jazakallahu Khairan. Your family&apos;s details have been recorded. You can re-open this form anytime to update them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Ashara Mubaraka 1448H — Chicago Registration</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Anjuman e Saifee Chicago</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
        )}

        {!family ? (
          <form onSubmit={findFamily} className="rounded-lg bg-white p-6 shadow-md dark:bg-gray-900">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Head-of-family ITS number
              <input
                value={hofInput}
                onChange={(e) => setHofInput(e.target.value)}
                required
                placeholder="e.g. 20365101"
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={loading || !hofInput.trim()}
              className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Finding…" : "Find my family"}
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {/* Members */}
            <section className="rounded-lg bg-white p-6 shadow-md dark:bg-gray-900">
              <h2 className="text-lg font-semibold">Family members</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Fill contact, travel, and rahat details for each traveling member.</p>
              <div className="mt-4 space-y-6">
                {members.map((m) => (
                  <div key={m.its} className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                    <p className="font-medium">
                      {m.full_name || m.its}
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        {m.is_head ? "Head · " : ""}{m.gender ?? ""}{m.age != null ? ` · ${m.age}y` : ""}{m.is_adult ? " · adult" : ""}
                      </span>
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm text-gray-700 dark:text-gray-300">WhatsApp number
                        <input value={m.whatsapp_e164 ?? ""} onChange={(e) => setMember(m.its, { whatsapp_e164: e.target.value })} placeholder="+1..." className={inputClass} />
                      </label>
                      <label className="text-sm text-gray-700 dark:text-gray-300">Email
                        <input type="email" value={m.email ?? ""} onChange={(e) => setMember(m.its, { email: e.target.value })} className={inputClass} />
                      </label>
                      <label className="text-sm text-gray-700 dark:text-gray-300">Arrival (date & time)
                        <input type="datetime-local" value={m.arrival_at ?? ""} onChange={(e) => setMember(m.its, { arrival_at: e.target.value })} className={inputClass} />
                      </label>
                      <label className="text-sm text-gray-700 dark:text-gray-300">Arrival flight #
                        <input value={m.arrival_flight_no ?? ""} onChange={(e) => setMember(m.its, { arrival_flight_no: e.target.value })} className={inputClass} />
                      </label>
                      <label className="text-sm text-gray-700 dark:text-gray-300">Departure (date & time)
                        <input type="datetime-local" value={m.departure_at ?? ""} onChange={(e) => setMember(m.its, { departure_at: e.target.value })} className={inputClass} />
                      </label>
                      <label className="text-sm text-gray-700 dark:text-gray-300">Departure flight #
                        <input value={m.departure_flight_no ?? ""} onChange={(e) => setMember(m.its, { departure_flight_no: e.target.value })} className={inputClass} />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-700 dark:text-gray-300">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={m.rahat_seating} onChange={(e) => setMember(m.its, { rahat_seating: e.target.checked })} />
                        Needs rahat seating
                      </label>
                      {m.rahat_seating && (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={m.wheelchair} onChange={(e) => setMember(m.its, { wheelchair: e.target.checked })} />
                          Wheelchair
                        </label>
                      )}
                    </div>
                    {m.rahat_seating && (
                      <label className="mt-2 block text-sm text-gray-700 dark:text-gray-300">Special needs
                        <input value={m.special_needs ?? ""} onChange={(e) => setMember(m.its, { special_needs: e.target.value })} className={inputClass} />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Accommodation */}
            <section className="rounded-lg bg-white p-6 shadow-md dark:bg-gray-900">
              <h2 className="text-lg font-semibold">Accommodation</h2>
              <div className="mt-3 flex gap-4 text-sm text-gray-700 dark:text-gray-300">
                {["hotel", "utaro"].map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <input type="radio" name="acc_type" checked={acc.acc_type === t} onChange={() => setAcc((a) => ({ ...a, acc_type: t }))} />
                    {t === "hotel" ? "Hotel" : "Utaro (host family)"}
                  </label>
                ))}
              </div>
              {acc.acc_type === "hotel" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-gray-700 dark:text-gray-300">Hotel name
                    <input value={acc.hotel_name ?? ""} onChange={(e) => setAcc((a) => ({ ...a, hotel_name: e.target.value }))} className={inputClass} />
                  </label>
                  <label className="text-sm text-gray-700 dark:text-gray-300">Hotel address
                    <input value={acc.hotel_address ?? ""} onChange={(e) => setAcc((a) => ({ ...a, hotel_address: e.target.value }))} className={inputClass} />
                  </label>
                </div>
              )}
              {acc.acc_type === "utaro" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-gray-700 dark:text-gray-300">Host name
                    <input value={acc.utaro_host_name ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_name: e.target.value }))} className={inputClass} />
                  </label>
                  <label className="text-sm text-gray-700 dark:text-gray-300">Host ITS
                    <input value={acc.utaro_host_its ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_its: e.target.value }))} className={inputClass} />
                  </label>
                  <label className="text-sm text-gray-700 dark:text-gray-300">Host address
                    <input value={acc.utaro_host_address ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_address: e.target.value }))} className={inputClass} />
                  </label>
                  <label className="text-sm text-gray-700 dark:text-gray-300">Host WhatsApp
                    <input value={acc.utaro_host_whatsapp_e164 ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_whatsapp_e164: e.target.value }))} className={inputClass} />
                  </label>
                  <label className="text-sm text-gray-700 dark:text-gray-300">Host email
                    <input value={acc.utaro_host_email ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_email: e.target.value }))} className={inputClass} />
                  </label>
                </div>
              )}
            </section>

            {/* Transport */}
            <section className="rounded-lg bg-white p-6 shadow-md dark:bg-gray-900">
              <h2 className="text-lg font-semibold">Transport</h2>
              <label className="mt-3 block text-sm text-gray-700 dark:text-gray-300">How will you get around daily?
                <select value={acc.transport_mode ?? ""} onChange={(e) => setAcc((a) => ({ ...a, transport_mode: e.target.value }))} className={inputClass}>
                  <option value="">Select…</option>
                  <option value="rideshare">Rideshare (Uber/Lyft)</option>
                  <option value="rental">Rental car</option>
                  <option value="commute_with_utaro">Commute with utaro family</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {acc.transport_mode === "other" && (
                <label className="mt-2 block text-sm text-gray-700 dark:text-gray-300">Details
                  <input value={acc.transport_detail ?? ""} onChange={(e) => setAcc((a) => ({ ...a, transport_detail: e.target.value }))} className={inputClass} />
                </label>
              )}
            </section>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit registration"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
