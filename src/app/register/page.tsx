"use client";

import { useRef, useState } from "react";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";

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
  airport: string | null;
  not_attending: boolean;
  wants_khidmat: boolean | null;
  khidmat_department_ids: string[];
  rahat_seating: boolean;
  wheelchair: boolean;
  special_needs: string | null;
};

type Department = { id: string; name: string };

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

// Internal Google Form local mumineen use to sign up for khidmat.
const KHIDMAT_SIGNUP_URL = "https://docs.google.com/forms/d/e/1FAIpQLSeM6KNofcUO4e6sXgw9fjHbqgenuT0LcygJ9X8QBZmVglKksQ/viewform?usp=send_form";

const inputClass =
  "mt-1 block w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/60";
const labelClass = "block text-sm font-medium text-emerald-950/80";
const cardClass = "rounded-2xl bg-[#faf8f1] p-6 shadow-2xl ring-1 ring-emerald-950/5";
const sectionHeading = "font-serif text-xl font-semibold text-emerald-950";
const goldBtn =
  "rounded-full bg-amber-400 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-md transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60";

type AddrPick = { address: string; name: string | null; lat: number | null; lon: number | null };
type PhotonFeature = {
  properties?: { name?: string; street?: string; housenumber?: string; city?: string; state?: string; postcode?: string; country?: string };
  geometry?: { coordinates?: number[] };
};

// Free OpenStreetMap-based address autocomplete (Photon). No API key required.
function AddressAutocomplete({ value, onPick, id, invalid, className }: { value: string; onPick: (p: AddrPick) => void; id?: string; invalid?: boolean; className?: string }) {
  const [suggestions, setSuggestions] = useState<{ label: string; name: string | null; lat: number; lon: number }[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handle(v: string) {
    onPick({ address: v, name: null, lat: null, lon: null }); // typing invalidates the pinned coords
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
            return { label: parts.join(", "), name: p.name ?? null, lat: coords?.[1] ?? NaN, lon: coords?.[0] ?? NaN };
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
        id={id}
        value={value}
        onChange={(e) => handle(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
        placeholder="Start typing the hotel or address…"
        className={`${className ?? inputClass}${invalid ? " border-red-400 ring-2 ring-red-300" : ""}`}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-emerald-950/15 bg-white text-sm shadow-lg">
          {suggestions.map((s, i) => (
            <li key={`${s.lat}-${s.lon}-${i}`}>
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onPick({ address: s.label, name: s.name, lat: s.lat, lon: s.lon });
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

// Searchable multiselect of khidmat departments, capped at 3.
function KhidmatPicker({ departments, selected, onChange }: { departments: Department[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const nameById = new Map(departments.map((d) => [d.id, d.name]));
  const chosen = new Set(selected);
  const atLimit = selected.length >= 3;
  const matches = departments.filter((d) => !chosen.has(d.id) && d.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="mt-2">
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {selected.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900">
              {nameById.get(id) ?? id}
              <button type="button" onClick={() => onChange(selected.filter((x) => x !== id))} className="text-emerald-700 hover:text-emerald-900" aria-label="Remove">×</button>
            </span>
          ))}
        </div>
      )}
      {atLimit ? (
        <p className="text-xs text-emerald-950/55">Maximum of 3 departments selected. Remove one to change.</p>
      ) : (
        <div className="relative">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off"
            placeholder="Search departments…"
            className={inputClass}
          />
          {open && matches.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-emerald-950/15 bg-white text-sm shadow-lg">
              {matches.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); onChange([...selected, d.id]); setQ(""); }}
                    className="block w-full px-3 py-2 text-left text-gray-800 hover:bg-amber-50"
                  >
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function RegisterPage() {
  const [hofInput, setHofInput] = useState("");
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLocal, setIsLocal] = useState(false);
  const [acc, setAcc] = useState<Partial<Family>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [wasEdit, setWasEdit] = useState(false);
  const [locked, setLocked] = useState(false);
  const [errorField, setErrorField] = useState<string | null>(null);
  // ITS of non-head members whose flight details mirror the head's.
  const [sameAsHead, setSameAsHead] = useState<Set<string>>(new Set());
  // OTP edit flow
  const [otpPhase, setOtpPhase] = useState<"idle" | "sending" | "pending" | "verifying">("idle");
  const [otpMaskedEmail, setOtpMaskedEmail] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [editToken, setEditToken] = useState<string | null>(null);

  const fieldClass = (id: string) =>
    errorField === id ? `${inputClass} border-red-400 ring-2 ring-red-300` : inputClass;

  // The phone number input lives inside react-phone-number-input's flex row (flag + field),
  // so it skips the block/margin utilities used elsewhere.
  const phoneInputBase =
    "w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/60";
  const phoneFieldClass = (id: string) =>
    errorField === id ? `${phoneInputBase} border-red-400 ring-2 ring-red-300` : phoneInputBase;

  const copyFlight = (from: Member, to: Member): Member => ({
    ...to,
    arrival_at: from.arrival_at,
    arrival_flight_no: from.arrival_flight_no,
    departure_at: from.departure_at,
    departure_flight_no: from.departure_flight_no,
    airport: from.airport,
  });

  const headAttending = Boolean(members[0]) && !members[0]?.not_attending;

  // A mehman family that marks EVERY member not-attending isn't coming — they owe no
  // accommodation/transport, so those sections are hidden and not required.
  const allNotAttending = members.length > 0 && members.every((m) => m.not_attending);
  const needsAccommodation = !isLocal && !allNotAttending;

  // Non-head members linked to the head inherit the head's flight (computed, not stored, so
  // unchecking restores each member's own values). Suspended if the head isn't attending.
  function effectiveMembers(): Member[] {
    const head = members[0];
    if (!head) return members;
    return members.map((m, i) => (i > 0 && headAttending && sameAsHead.has(m.its) ? copyFlight(head, m) : m));
  }

  async function findFamily(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/register?hof=${encodeURIComponent(hofInput.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not find your family");
      if (data.locked) {
        setLocked(true);
        return;
      }
      const loaded = (data.members as Member[]).map((m) => ({
        ...m,
        arrival_at: toLocalInput(m.arrival_at),
        departure_at: toLocalInput(m.departure_at),
        wants_khidmat: null, // force an explicit Interested / Not interested choice
      }));
      const local = Boolean(data.is_local);
      setIsLocal(local);
      setFamily(data.family as Family);
      setAcc(data.family as Family);
      setDepartments((data.departments as Department[]) ?? []);
      setMembers(loaded);
      // Default everyone (other than the head) to "same flight as head"; they can uncheck. (Mehman only.)
      setSameAsHead(local ? new Set() : new Set(loaded.slice(1).map((m) => m.its)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not find your family");
    } finally {
      setLoading(false);
    }
  }

  function setMember(its: string, patch: Partial<Member>) {
    setMembers((prev) => prev.map((m) => (m.its === its ? { ...m, ...patch } : m)));
  }

  function toggleSameAsHead(its: string, checked: boolean) {
    setSameAsHead((prev) => {
      const next = new Set(prev);
      if (checked) next.add(its);
      else next.delete(its);
      return next;
    });
  }

  // One-time submission: everything is required except flight numbers and the rahat/same-flight
  // checkboxes. Mirrored server-side. Returns the first problem + the field to focus.
  function validate(): { message: string; fieldId: string } | null {
    if (members.length === 0) return { message: "No family members found.", fieldId: "" };
    for (const m of effectiveMembers()) {
      if (m.not_attending) continue;
      const who = m.full_name || m.its;
      if (!m.whatsapp_e164?.trim()) return { message: `Enter a WhatsApp number for ${who}.`, fieldId: `reg-${m.its}-whatsapp` };
      if (!m.email?.trim() || !/^\S+@\S+\.\S+$/.test(m.email.trim()))
        return { message: `Enter a valid email for ${who}.`, fieldId: `reg-${m.its}-email` };
      if (!isLocal && !m.arrival_at) return { message: `Enter arrival date & time for ${who}.`, fieldId: `reg-${m.its}-arrival` };
      if (!isLocal && !m.departure_at) return { message: `Enter departure date & time for ${who}.`, fieldId: `reg-${m.its}-departure` };
      if (!isLocal && m.wants_khidmat !== true && m.wants_khidmat !== false) return { message: `Select khidmat interest for ${who}.`, fieldId: `reg-${m.its}-khidmat` };
    }
    if (needsAccommodation && acc.acc_type !== "hotel" && acc.acc_type !== "utaro") return { message: "Select your accommodation type.", fieldId: "reg-acc-type" };
    if (needsAccommodation && acc.acc_type === "hotel") {
      const hotelNameTrimmed = acc.hotel_name?.trim() ?? "";
      const JUNK = new Set(["pending", "na", "n/a", "n.a", "tbd", "tba", "none", "unknown", "no", "-", "--", "hotel"]);
      if (!hotelNameTrimmed) return { message: "Enter your hotel name.", fieldId: "reg-hotel-name" };
      if (JUNK.has(hotelNameTrimmed.toLowerCase())) return { message: `Please enter the actual name of your hotel (e.g. "Marriott O'Hare").`, fieldId: "reg-hotel-name" };
      if (!acc.hotel_address?.trim()) return { message: "Enter your hotel address.", fieldId: "reg-hotel-address" };
    }
    if (needsAccommodation && acc.acc_type === "utaro" && !acc.utaro_host_name?.trim()) {
      return { message: "Enter the host's name.", fieldId: "reg-host-name" };
    }
    if (needsAccommodation) {
      if (!acc.transport_mode?.trim()) return { message: "Select how you will get to the relay center.", fieldId: "reg-transport-mode" };
      if (acc.transport_mode === "other" && !acc.transport_detail?.trim()) return { message: "Enter your transport details.", fieldId: "reg-transport-detail" };
    }
    return null;
  }

  async function requestOtp() {
    setOtpPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/register/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ its: hofInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send code");
      setOtpMaskedEmail(data.masked_email ?? null);
      setOtpPhase("pending");
      setOtpInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
      setOtpPhase("idle");
    }
  }

  async function verifyOtp(event: React.FormEvent) {
    event.preventDefault();
    setOtpPhase("verifying");
    setError(null);
    try {
      const res = await fetch("/api/register/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ its: hofInput.trim(), otp: otpInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Invalid code");
      // OTP verified — load the prefilled form
      const loaded = (data.members as Member[]).map((m) => ({
        ...m,
        arrival_at: toLocalInput(m.arrival_at),
        departure_at: toLocalInput(m.departure_at),
        wants_khidmat: m.wants_khidmat,
      }));
      setIsLocal(Boolean(data.is_local));
      setFamily(data.family as Family);
      setAcc(data.family as Family);
      setDepartments((data.departments as Department[]) ?? []);
      setMembers(loaded);
      setEditToken(data.edit_token as string);
      setLocked(false);
      setOtpPhase("idle");
      setSameAsHead(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
      setOtpPhase("pending");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!family) return;
    const problem = validate();
    if (problem) {
      setError(problem.message);
      setErrorField(problem.fieldId);
      const el = document.getElementById(problem.fieldId);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
      return;
    }
    setErrorField(null);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hof_its: family.hof_its,
          submitted_by_its: members[0]?.its ?? null,
          members: effectiveMembers(),
          ...(editToken ? { edit_token: editToken } : {}),
          accommodation: {
            acc_type: acc.acc_type,
            hotel_name: acc.hotel_name,
            hotel_address: acc.hotel_address,
            hotel_lat: acc.hotel_lat,
            hotel_lon: acc.hotel_lon,
            open_to_utaro: acc.open_to_utaro,
            utaro_host_name: acc.utaro_host_name,
            utaro_host_its: acc.utaro_host_its,
            utaro_host_whatsapp_e164: acc.utaro_host_whatsapp_e164,
          },
          transport: { transport_mode: acc.transport_mode, transport_detail: acc.transport_detail },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.locked) {
        setLocked(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Could not submit");
      setWasEdit(Boolean(editToken));
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
            Ashara Mubaraka 1448H — Chicago Relay Center
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
            <h2 className="font-serif text-2xl font-bold text-emerald-800">
              {wasEdit ? "Registration updated" : "Registration received"}
            </h2>
            <p className="mt-3 text-sm text-emerald-950/70">
              Jazakallahu Khairan. Your family&apos;s details have been {wasEdit ? "updated" : "recorded"}.
              {" "}To make changes, return to this page and enter your ITS number again.
            </p>
          </div>
        ) : locked && (otpPhase === "pending" || otpPhase === "verifying") ? (
          <form onSubmit={verifyOtp} className={`${cardClass} mx-auto max-w-md`}>
            <h2 className={sectionHeading}>Enter your code</h2>
            <p className="mt-2 text-sm text-emerald-950/70">
              A 6-digit code was sent to <span className="font-medium text-emerald-900">{otpMaskedEmail}</span>. It expires in 10 minutes.
            </p>
            <label className="mt-4 block text-sm font-medium text-emerald-950/80">
              Verification code
              <input
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className={`${inputClass} mt-1 text-center text-xl tracking-widest`}
                maxLength={6}
                disabled={otpPhase === "verifying"}
              />
            </label>
            <button
              type="submit"
              disabled={otpInput.length !== 6 || otpPhase === "verifying"}
              className={`${goldBtn} mt-5 w-full`}
            >
              {otpPhase === "verifying" ? "Verifying…" : "Verify & open form"}
            </button>
            <button
              type="button"
              disabled={otpPhase === "verifying"}
              onClick={() => { setOtpPhase("idle"); setError(null); }}
              className="mt-3 block w-full text-center text-sm text-emerald-800 underline disabled:opacity-50"
            >
              Back
            </button>
            <p className="mt-4 text-center text-xs text-emerald-950/50">
              Didn&apos;t receive it?{" "}
              <button type="button" disabled={otpPhase === "verifying"} onClick={requestOtp} className="underline disabled:opacity-50">
                Resend code
              </button>
            </p>
          </form>
        ) : locked ? (
          <div className={`${cardClass} mx-auto max-w-md text-center`}>
            <h2 className="font-serif text-2xl font-bold text-emerald-800">Already registered</h2>
            <p className="mt-3 text-sm text-emerald-950/70">
              This family&apos;s registration has already been submitted.
            </p>
            <button
              type="button"
              onClick={requestOtp}
              disabled={otpPhase === "sending"}
              className={`${goldBtn} mt-5 w-full`}
            >
              {otpPhase === "sending" ? "Sending code…" : "Edit my registration"}
            </button>
            <p className="mt-3 text-xs text-emerald-950/55">
              We&apos;ll email a one-time code to the head of family to verify your identity.
            </p>
            <button
              type="button"
              onClick={() => { setLocked(false); setHofInput(""); setError(null); setOtpPhase("idle"); }}
              className="mt-5 text-sm text-emerald-800 underline"
            >
              Enter a different ITS number
            </button>
          </div>
        ) : !family ? (
          <form onSubmit={findFamily} className={`${cardClass} mx-auto max-w-md`}>
            <h2 className={sectionHeading}>Find your family</h2>
            <label className="mt-4 block text-sm font-medium text-emerald-950/80">
              Your ITS number
              <span className="mt-1 block text-xs font-normal text-emerald-950/55">
                Enter the ITS number of any family member.
              </span>
              <input
                value={hofInput}
                onChange={(e) => setHofInput(e.target.value)}
                required
                placeholder="e.g. 20365101"
                className={`${inputClass} mt-1`}
              />
            </label>
            <button type="submit" disabled={loading || !hofInput.trim()} className={`${goldBtn} mt-5 w-full`}>
              {loading ? "Finding…" : "Find my family"}
            </button>
            <p className="mt-5 border-t border-emerald-950/10 pt-4 text-center text-xs text-emerald-950/60">
              Need help? Message our helpline on WhatsApp:{" "}
              <a href="https://wa.me/16308190250" className="font-semibold text-emerald-800 underline">+1 630 819 0250</a>
            </p>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {/* Members */}
            <section className={cardClass}>
              <h2 className={sectionHeading}>Family members</h2>
              {editToken && (
                <p className="mt-1 text-sm text-emerald-950/60">Review and update your family&apos;s details below.</p>
              )}
              <div className="mt-4 space-y-5">
                {members.map((m, idx) => (
                  <div key={m.its} className="rounded-xl border border-emerald-950/10 bg-white/70 p-4">
                    <p className="font-medium text-emerald-950">
                      {m.full_name || m.its}
                      <span className="ml-2 text-xs font-normal text-emerald-950/50">
                        {m.is_head ? "Head · " : ""}{m.gender ?? ""}{m.age != null ? ` · ${m.age}y` : ""}{m.is_adult ? " · adult" : ""}
                      </span>
                    </p>
                    {/* Available to every family (local and mehman): a member may be on the roster
                        but not attending. Their per-member details are skipped when this is checked. */}
                    <label className="mt-2 flex items-center gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900">
                      <input type="checkbox" className="h-4 w-4 accent-rose-500" checked={m.not_attending} onChange={(e) => { setMember(m.its, { not_attending: e.target.checked }); if (e.target.checked) setErrorField(null); }} />
                      Will not be attending
                    </label>
                    {!m.not_attending && (
                      <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className={labelClass}>WhatsApp number<span className="text-red-500"> *</span>
                        <PhoneInput
                          international
                          defaultCountry="US"
                          value={m.whatsapp_e164 || undefined}
                          onChange={(v) => { setMember(m.its, { whatsapp_e164: v ?? "" }); if (errorField === `reg-${m.its}-whatsapp`) setErrorField(null); }}
                          numberInputProps={{ id: `reg-${m.its}-whatsapp`, className: phoneFieldClass(`reg-${m.its}-whatsapp`) }}
                          className="mt-1"
                        />
                      </label>
                      <label className={labelClass}>Email<span className="text-red-500"> *</span>
                        <input id={`reg-${m.its}-email`} type="email" value={m.email ?? ""} onChange={(e) => { setMember(m.its, { email: e.target.value }); if (errorField === `reg-${m.its}-email`) setErrorField(null); }} className={fieldClass(`reg-${m.its}-email`)} />
                      </label>
                    </div>

                    {!isLocal && (
                      <>
                    {idx > 0 && (
                      <label className="mt-3 flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-sm font-medium text-emerald-900">
                        <input type="checkbox" className="h-4 w-4 accent-amber-500" checked={sameAsHead.has(m.its)} onChange={(e) => toggleSameAsHead(m.its, e.target.checked)} />
                        Same flight details as {members[0].full_name || "head of family"}
                      </label>
                    )}

                    {idx === 0 || !sameAsHead.has(m.its) ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className={labelClass}>Arrival (date & time)<span className="text-red-500"> *</span>
                          <input id={`reg-${m.its}-arrival`} type="datetime-local" value={m.arrival_at ?? ""} onChange={(e) => { setMember(m.its, { arrival_at: e.target.value }); if (errorField === `reg-${m.its}-arrival`) setErrorField(null); }} className={fieldClass(`reg-${m.its}-arrival`)} />
                        </label>
                        <label className={labelClass}>Arrival flight #
                          <input value={m.arrival_flight_no ?? ""} onChange={(e) => setMember(m.its, { arrival_flight_no: e.target.value })} className={inputClass} />
                        </label>
                        <label className={labelClass}>Departure (date & time)<span className="text-red-500"> *</span>
                          <input id={`reg-${m.its}-departure`} type="datetime-local" value={m.departure_at ?? ""} onChange={(e) => { setMember(m.its, { departure_at: e.target.value }); if (errorField === `reg-${m.its}-departure`) setErrorField(null); }} className={fieldClass(`reg-${m.its}-departure`)} />
                        </label>
                        <label className={labelClass}>Departure flight #
                          <input value={m.departure_flight_no ?? ""} onChange={(e) => setMember(m.its, { departure_flight_no: e.target.value })} className={inputClass} />
                        </label>
                        <label className={labelClass}>Airport
                          <select value={m.airport ?? ""} onChange={(e) => setMember(m.its, { airport: e.target.value })} className={inputClass}>
                            <option value="">Select…</option>
                            <option value="ORD">ORD — O&apos;Hare</option>
                            <option value="MDW">MDW — Midway</option>
                          </select>
                        </label>
                      </div>
                    ) : (
                      <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        Using {members[0].full_name || "the head of family"}&apos;s flight details.
                      </p>
                    )}
                      </>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-emerald-950/80">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" className="accent-amber-500" checked={m.rahat_seating} onChange={(e) => setMember(m.its, { rahat_seating: e.target.checked })} />
                        Rahat/Chair seating
                      </label>
                      {m.rahat_seating && (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" className="accent-amber-500" checked={m.wheelchair} onChange={(e) => setMember(m.its, { wheelchair: e.target.checked })} />
                          Wheelchair
                        </label>
                      )}
                    </div>
                    <label className={`${labelClass} mt-3`}>
                      <span className="flex items-center gap-1.5">
                        Special needs <span className="text-zinc-400">(optional)</span>
                        <span
                          title="Optional — list any special information such as food allergies, dietary restrictions, medical conditions, medication, or mobility/accessibility needs. Leave blank if not applicable."
                          aria-label="Special needs help"
                          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-emerald-700 text-[10px] font-bold text-white"
                        >i</span>
                      </span>
                      <input id={`reg-${m.its}-special`} value={m.special_needs ?? ""} placeholder="Allergies, dietary, medical, accessibility… (optional)" onChange={(e) => { setMember(m.its, { special_needs: e.target.value }); if (errorField === `reg-${m.its}-special`) setErrorField(null); }} className={fieldClass(`reg-${m.its}-special`)} />
                    </label>

                    <div id={`reg-${m.its}-khidmat`} className="mt-3 border-t border-emerald-950/10 pt-3">
                      <p className={labelClass}>Khidmat{!isLocal && <span className="text-red-500"> *</span>}</p>
                      {isLocal ? (
                        <p className="mt-1 text-sm text-emerald-950/70">
                          If you haven&apos;t already signed up for khidmat, you can{" "}
                          <a href={KHIDMAT_SIGNUP_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-800 underline">sign up here</a>.
                        </p>
                      ) : (
                        <>
                          <div className="mt-2 flex gap-6 text-sm text-emerald-950/80">
                            <label className="flex items-center gap-2">
                              <input type="radio" name={`khidmat-${m.its}`} className="accent-amber-500" checked={m.wants_khidmat === true} onChange={() => { setMember(m.its, { wants_khidmat: true }); if (errorField === `reg-${m.its}-khidmat`) setErrorField(null); }} />
                              Interested
                            </label>
                            <label className="flex items-center gap-2">
                              <input type="radio" name={`khidmat-${m.its}`} className="accent-amber-500" checked={m.wants_khidmat === false} onChange={() => { setMember(m.its, { wants_khidmat: false, khidmat_department_ids: [] }); if (errorField === `reg-${m.its}-khidmat`) setErrorField(null); }} />
                              Not interested
                            </label>
                          </div>
                          {errorField === `reg-${m.its}-khidmat` && (
                            <p className="mt-1 text-xs text-red-600">Please choose one.</p>
                          )}
                          {m.wants_khidmat === true && (
                            <KhidmatPicker
                              departments={departments}
                              selected={m.khidmat_department_ids ?? []}
                              onChange={(ids) => setMember(m.its, { khidmat_department_ids: ids })}
                            />
                          )}
                        </>
                      )}
                    </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Accommodation (mehman only; hidden when the whole family isn't attending) */}
            {needsAccommodation && (
            <section className={cardClass}>
              <h2 className={sectionHeading}>Accommodation<span className="text-red-500"> *</span></h2>
              <div id="reg-acc-type" className="mt-3 flex flex-col gap-3 text-sm text-emerald-950/80 sm:flex-row sm:gap-6">
                {["hotel", "utaro"].map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <input type="radio" name="acc_type" className="accent-amber-500" checked={acc.acc_type === t} onChange={() => { setAcc((a) => ({ ...a, acc_type: t })); if (errorField === "reg-acc-type") setErrorField(null); }} />
                    {t === "hotel" ? "Hotel" : "Staying with friends and family"}
                  </label>
                ))}
              </div>
              {acc.acc_type === "hotel" && (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Hotel name<span className="text-red-500"> *</span>
                      <input id="reg-hotel-name" value={acc.hotel_name ?? ""} onChange={(e) => { setAcc((a) => ({ ...a, hotel_name: e.target.value })); if (errorField === "reg-hotel-name") setErrorField(null); }} className={fieldClass("reg-hotel-name")} />
                    </label>
                    <div>
                      <span className={labelClass}>Hotel address<span className="text-red-500"> *</span></span>
                      <AddressAutocomplete
                        id="reg-hotel-address"
                        invalid={errorField === "reg-hotel-address"}
                        className={`${inputClass} mt-1`}
                        value={acc.hotel_address ?? ""}
                        onPick={(p) => {
                          if (errorField === "reg-hotel-address") setErrorField(null);
                          // Backfill the hotel name from the lookup when it's still empty.
                          setAcc((a) => ({
                            ...a,
                            hotel_address: p.address,
                            hotel_lat: p.lat,
                            hotel_lon: p.lon,
                            hotel_name: a.hotel_name?.trim() ? a.hotel_name : (p.name ?? a.hotel_name ?? null),
                          }));
                        }}
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
                  <label className="flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-base font-medium text-emerald-950/90">
                    <input type="checkbox" className="mt-1 h-5 w-5 accent-amber-500" checked={Boolean(acc.open_to_utaro)} onChange={(e) => setAcc((a) => ({ ...a, open_to_utaro: e.target.checked }))} />
                    <span>
                      I have a hotel booked and would consider Utaro if reached out to.
                      <span className="mt-1.5 block text-sm font-normal text-amber-800">
                        Utaro capacity is extremely limited this year. Please ensure you have a confirmed hotel booking — we strongly recommend not relying on Utaro as your primary accommodation.
                      </span>
                    </span>
                  </label>
                </div>
              )}
              {acc.acc_type === "utaro" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Host name<span className="text-red-500"> *</span>
                    <input id="reg-host-name" value={acc.utaro_host_name ?? ""} onChange={(e) => { setAcc((a) => ({ ...a, utaro_host_name: e.target.value })); if (errorField === "reg-host-name") setErrorField(null); }} className={fieldClass("reg-host-name")} />
                  </label>
                  <label className={labelClass}>Host HOF ITS number
                    <input value={acc.utaro_host_its ?? ""} onChange={(e) => setAcc((a) => ({ ...a, utaro_host_its: e.target.value }))} className={inputClass} />
                  </label>
                  <label className={labelClass}>Host contact number
                    <PhoneInput
                      international
                      defaultCountry="US"
                      value={acc.utaro_host_whatsapp_e164 || undefined}
                      onChange={(v) => setAcc((a) => ({ ...a, utaro_host_whatsapp_e164: v ?? "" }))}
                      numberInputProps={{ className: phoneInputBase }}
                      className="mt-1"
                    />
                  </label>
                </div>
              )}
            </section>
            )}

            {/* Transport (mehman only; hidden when the whole family isn't attending) */}
            {needsAccommodation && (
            <section className={cardClass}>
              <h2 className={sectionHeading}>Transport</h2>
              <label className={`${labelClass} mt-3`}>How will you get to the relay center daily?<span className="text-red-500"> *</span>
                <select id="reg-transport-mode" value={acc.transport_mode ?? ""} onChange={(e) => { setAcc((a) => ({ ...a, transport_mode: e.target.value })); if (errorField === "reg-transport-mode") setErrorField(null); }} className={fieldClass("reg-transport-mode")}>
                  <option value="">Select…</option>
                  <option value="rideshare">Rideshare (Uber/Lyft)</option>
                  <option value="rental">Rental car</option>
                  <option value="commute_with_utaro">Commute with friends and family</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {acc.transport_mode === "other" && (
                <label className={`${labelClass} mt-2`}>Details<span className="text-red-500"> *</span>
                  <input id="reg-transport-detail" value={acc.transport_detail ?? ""} onChange={(e) => { setAcc((a) => ({ ...a, transport_detail: e.target.value })); if (errorField === "reg-transport-detail") setErrorField(null); }} className={fieldClass("reg-transport-detail")} />
                </label>
              )}
            </section>
            )}

            <div className="flex flex-col items-center gap-3 pb-4">
              {error && (
                <p className="w-full rounded-lg border border-red-300/40 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
                  {error}
                </p>
              )}
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
