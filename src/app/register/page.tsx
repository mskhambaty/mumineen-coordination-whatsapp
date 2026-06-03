"use client";

import { useRef, useState } from "react";

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
  hotel_lat: number | null;
  hotel_lon: number | null;
  open_to_utaro: boolean;
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

type AddrPick = { address: string; lat: number | null; lon: number | null };
type PhotonFeature = {
  properties?: { name?: string; street?: string; housenumber?: string; city?: string; state?: string; postcode?: string; country?: string };
  geometry?: { coordinates?: number[] };
};

// Free OpenStreetMap-based address autocomplete (Photon). No API key required.
function AddressAutocomplete({ value, onPick }: { value: string; onPick: (p: AddrPick) => void }) {
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handle(v: string) {
    onPick({ address: v, lat: null, lon: null }); // typing invalidates the pinned coords
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(v)}&limit=5`);
        const data = (await res.json()) as { features?: PhotonFeature[] };
        const feats = (data.features ?? [])
          .map((f) => {
            const p = f.properties ?? {};
            const line = [p.housenumber, p.street].filter(Boolean).join(" ");
            const parts = [p.name, line, p.city, p.state, p.postcode, p.country].filter(Boolean);
            const coords = f.geometry?.coordinates;
            return { label: parts.join(", "), lat: coords?.[1] ?? NaN, lon: coords?.[0] ?? NaN };
          })
          .filter((s) => s.label && Number.isFinite(s.lat) && Number.isFinite(s.lon));
        setSuggestions(feats);
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 350);
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => handle(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
        placeholder="Start typing the hotel or address…"
        className={inputClass}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-emerald-950/15 bg-white text-sm shadow-lg">
          {suggestions.map((s, i) => (
            <li key={`${s.lat}-${s.lon}-${i}`}>
              <button
                type="button"
                onClick={() => {
                  onPick({ address: s.label, lat: s.lat, lon: s.lon });
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-gray-800 hover:bg-amber-50"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RegisterPage() {
  const [hofInput, setHofInput] = useState("");
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [acc, setAcc] = useState<Partial<Family>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // ITS of non-head members whose flight details mirror the head's.
  const [sameAsHead, setSameAsHead] = useState<Set<string>>(new Set());

  const FLIGHT_KEYS: (keyof Member)[] = ["arrival_at", "arrival_flight_no", "departure_at", "departure_flight_no"];
  const copyFlight = (from: Member, to: Member): Member => ({
    ...to,
    arrival_at: from.arrival_at,
    arrival_flight_no: from.arrival_flight_no,
    departure_at: from.departure_at,
    departure_flight_no: from.departure_flight_no,
  });

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
    setMembers((prev) => {
      const next = prev.map((m) => (m.its === its ? { ...m, ...patch } : m));
      // Edits to the head's flight mirror to every member currently linked to the head.
      if (prev[0]?.its === its && FLIGHT_KEYS.some((k) => k in patch)) {
        return next.map((m, i) => (i === 0 || !sameAsHead.has(m.its) ? m : copyFlight(next[0], m)));
      }
      return next;
    });
  }

  function toggleSameAsHead(its: string, checked: boolean) {
    setSameAsHead((prev) => {
      const next = new Set(prev);
      if (checked) next.add(its);
      else next.delete(its);
      return next;
    });
    if (checked) {
      setMembers((prev) => (prev.length ? prev.map((m) => (m.its === its ? copyFlight(prev[0], m) : m)) : prev));
    }
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
            hotel_lat: acc.hotel_lat,
            hotel_lon: acc.hotel_lon,
            open_to_utaro: acc.open_to_utaro,
            utaro_host_its: acc.utaro_host_its,
            utaro_host_whatsapp_e164: acc.utaro_host_whatsapp_e164,
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
                {members.map((m, idx) => (
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
                    </div>

                    {idx > 0 && (
                      <label className="mt-3 flex items-center gap-2 text-sm text-emerald-950/80">
                        <input type="checkbox" className="accent-amber-500" checked={sameAsHead.has(m.its)} onChange={(e) => toggleSameAsHead(m.its, e.target.checked)} />
                        Same flight details as {members[0].full_name || "head of family"}
                      </label>
                    )}

                    {idx === 0 || !sameAsHead.has(m.its) ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                    ) : (
                      <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        Using {members[0].full_name || "the head of family"}&apos;s flight details.
                      </p>
                    )}

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
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Hotel name
                      <input value={acc.hotel_name ?? ""} onChange={(e) => setAcc((a) => ({ ...a, hotel_name: e.target.value }))} className={inputClass} />
                    </label>
                    <div>
                      <span className={labelClass}>Hotel address</span>
                      <AddressAutocomplete
                        value={acc.hotel_address ?? ""}
                        onPick={(p) => setAcc((a) => ({ ...a, hotel_address: p.address, hotel_lat: p.lat, hotel_lon: p.lon }))}
                      />
                    </div>
                  </div>
                  {acc.hotel_lat != null && acc.hotel_lon != null && (
                    <div className="overflow-hidden rounded-lg border border-emerald-950/10">
                      <iframe
                        title="Hotel location"
                        className="h-52 w-full"
                        loading="lazy"
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${acc.hotel_lon - 0.01}%2C${acc.hotel_lat - 0.01}%2C${acc.hotel_lon + 0.01}%2C${acc.hotel_lat + 0.01}&layer=mapnik&marker=${acc.hotel_lat}%2C${acc.hotel_lon}`}
                      />
                    </div>
                  )}
                  <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-emerald-950/80">
                    <input type="checkbox" className="mt-0.5 accent-amber-500" checked={Boolean(acc.open_to_utaro)} onChange={(e) => setAcc((a) => ({ ...a, open_to_utaro: e.target.checked }))} />
                    <span>
                      I have a hotel booked, but I am open to Utaro if a host family can offer it.
                      <span className="mt-1 block text-xs text-amber-800">
                        Utaro is subject to availability. Mehmaan are advised to book a refundable hotel and not depend on Utaro completely.
                      </span>
                    </span>
                  </label>
                </div>
              )}
              {acc.acc_type === "utaro" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Host family ITS
                    <input value={acc.utaro_host_its ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_its: e.target.value }))} className={inputClass} />
                  </label>
                  <label className={labelClass}>Host contact number
                    <input value={acc.utaro_host_whatsapp_e164 ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_whatsapp_e164: e.target.value }))} placeholder="+1..." className={inputClass} />
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
