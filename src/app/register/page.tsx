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
  "mt-1 block w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/60";
const labelClass = "block text-sm font-medium text-emerald-950/80";
const cardClass = "rounded-2xl bg-[#faf8f1] p-6 shadow-2xl ring-1 ring-emerald-950/5";
const sectionHeading = "font-serif text-xl font-semibold text-emerald-950";
const goldBtn =
  "rounded-full bg-amber-400 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-md transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60";

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a3d2e] via-[#093528] to-[#061f17] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        {/* Hero */}
        <header className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold leading-tight text-white sm:text-4xl">
            Ashara Mubaraka 1448H — Chicago
          </h1>
          <p className="mt-2 font-serif text-lg text-amber-300">Mumineen Registration</p>
          <p className="mx-auto mt-3 max-w-xl text-sm text-emerald-100/70">
            Anjuman e Saifee Chicago · Please confirm your family&apos;s travel and accommodation details below.
          </p>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-300/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {done ? (
          <div className={`${cardClass} text-center`}>
            <h2 className="font-serif text-2xl font-bold text-emerald-800">Registration received</h2>
            <p className="mt-3 text-sm text-emerald-950/70">
              Jazakallahu Khairan. Your family&apos;s details have been recorded. You can reopen this form anytime to update them.
            </p>
          </div>
        ) : !family ? (
          <form onSubmit={findFamily} className={`${cardClass} mx-auto max-w-md`}>
            <h2 className={sectionHeading}>Find your family</h2>
            <label className="mt-4 block text-sm font-medium text-emerald-950/80">
              Head-of-family ITS number
              <input
                value={hofInput}
                onChange={(e) => setHofInput(e.target.value)}
                required
                placeholder="e.g. 20365101"
                className={inputClass}
              />
            </label>
            <button type="submit" disabled={loading || !hofInput.trim()} className={`${goldBtn} mt-5 w-full`}>
              {loading ? "Finding…" : "Find my family"}
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {/* Members */}
            <section className={cardClass}>
              <h2 className={sectionHeading}>Family members</h2>
              <p className="mt-1 text-sm text-emerald-950/60">
                Fill contact, travel, and rahat details for each traveling member.
              </p>
              <div className="mt-4 space-y-5">
                {members.map((m) => (
                  <div key={m.its} className="rounded-xl border border-emerald-950/10 bg-white/70 p-4">
                    <p className="font-medium text-emerald-950">
                      {m.full_name || m.its}
                      <span className="ml-2 text-xs font-normal text-emerald-950/50">
                        {m.is_head ? "Head · " : ""}{m.gender ?? ""}{m.age != null ? ` · ${m.age}y` : ""}{m.is_adult ? " · adult" : ""}
                      </span>
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className={labelClass}>WhatsApp number
                        <input value={m.whatsapp_e164 ?? ""} onChange={(e) => setMember(m.its, { whatsapp_e164: e.target.value })} placeholder="+1..." className={inputClass} />
                      </label>
                      <label className={labelClass}>Email
                        <input type="email" value={m.email ?? ""} onChange={(e) => setMember(m.its, { email: e.target.value })} className={inputClass} />
                      </label>
                      <label className={labelClass}>Arrival (date & time)
                        <input type="datetime-local" value={m.arrival_at ?? ""} onChange={(e) => setMember(m.its, { arrival_at: e.target.value })} className={inputClass} />
                      </label>
                      <label className={labelClass}>Arrival flight #
                        <input value={m.arrival_flight_no ?? ""} onChange={(e) => setMember(m.its, { arrival_flight_no: e.target.value })} className={inputClass} />
                      </label>
                      <label className={labelClass}>Departure (date & time)
                        <input type="datetime-local" value={m.departure_at ?? ""} onChange={(e) => setMember(m.its, { departure_at: e.target.value })} className={inputClass} />
                      </label>
                      <label className={labelClass}>Departure flight #
                        <input value={m.departure_flight_no ?? ""} onChange={(e) => setMember(m.its, { departure_flight_no: e.target.value })} className={inputClass} />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-emerald-950/80">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" className="accent-amber-500" checked={m.rahat_seating} onChange={(e) => setMember(m.its, { rahat_seating: e.target.checked })} />
                        Needs rahat seating
                      </label>
                      {m.rahat_seating && (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" className="accent-amber-500" checked={m.wheelchair} onChange={(e) => setMember(m.its, { wheelchair: e.target.checked })} />
                          Wheelchair
                        </label>
                      )}
                    </div>
                    {m.rahat_seating && (
                      <label className={`${labelClass} mt-2`}>Special needs
                        <input value={m.special_needs ?? ""} onChange={(e) => setMember(m.its, { special_needs: e.target.value })} className={inputClass} />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Accommodation */}
            <section className={cardClass}>
              <h2 className={sectionHeading}>Accommodation</h2>
              <div className="mt-3 flex gap-4 text-sm text-emerald-950/80">
                {["hotel", "utaro"].map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <input type="radio" name="acc_type" className="accent-amber-500" checked={acc.acc_type === t} onChange={() => setAcc((a) => ({ ...a, acc_type: t }))} />
                    {t === "hotel" ? "Hotel" : "Utaro (host family)"}
                  </label>
                ))}
              </div>
              {acc.acc_type === "hotel" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Hotel name
                    <input value={acc.hotel_name ?? ""} onChange={(e) => setAcc((a) => ({ ...a, hotel_name: e.target.value }))} className={inputClass} />
                  </label>
                  <label className={labelClass}>Hotel address
                    <input value={acc.hotel_address ?? ""} onChange={(e) => setAcc((a) => ({ ...a, hotel_address: e.target.value }))} className={inputClass} />
                  </label>
                </div>
              )}
              {acc.acc_type === "utaro" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Host name
                    <input value={acc.utaro_host_name ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_name: e.target.value }))} className={inputClass} />
                  </label>
                  <label className={labelClass}>Host ITS
                    <input value={acc.utaro_host_its ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_its: e.target.value }))} className={inputClass} />
                  </label>
                  <label className={labelClass}>Host address
                    <input value={acc.utaro_host_address ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_address: e.target.value }))} className={inputClass} />
                  </label>
                  <label className={labelClass}>Host WhatsApp
                    <input value={acc.utaro_host_whatsapp_e164 ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_whatsapp_e164: e.target.value }))} className={inputClass} />
                  </label>
                  <label className={labelClass}>Host email
                    <input value={acc.utaro_host_email ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_email: e.target.value }))} className={inputClass} />
                  </label>
                </div>
              )}
            </section>

            {/* Transport */}
            <section className={cardClass}>
              <h2 className={sectionHeading}>Transport</h2>
              <label className={`${labelClass} mt-3`}>How will you get around daily?
                <select value={acc.transport_mode ?? ""} onChange={(e) => setAcc((a) => ({ ...a, transport_mode: e.target.value }))} className={inputClass}>
                  <option value="">Select…</option>
                  <option value="rideshare">Rideshare (Uber/Lyft)</option>
                  <option value="rental">Rental car</option>
                  <option value="commute_with_utaro">Commute with utaro family</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {acc.transport_mode === "other" && (
                <label className={`${labelClass} mt-2`}>Details
                  <input value={acc.transport_detail ?? ""} onChange={(e) => setAcc((a) => ({ ...a, transport_detail: e.target.value }))} className={inputClass} />
                </label>
              )}
            </section>

            <div className="flex justify-center pb-4">
              <button type="submit" disabled={submitting} className={`${goldBtn} w-full sm:w-auto sm:px-12`}>
                {submitting ? "Submitting…" : "Submit registration"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
