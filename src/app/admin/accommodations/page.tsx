"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";

import { canManageParking } from "@/lib/admin/access";

type HostRow = {
  id: string;
  hof_its: string;
  display_name: string;
  address: string | null;
  city: string | null;
  capacity_mehman: number;
  capacity_family_friends: number;
  include_family_friends: boolean;
  effective_capacity: number;
  confirmed_allocated: number;
  pending_allocated: number;
  remaining_capacity: number;
  gender_preference: string | null;
  distance_to_masjid_km: number | null;
  host_family_size: number | null;
};

type GuestRow = {
  family_id: string;
  hof_its: string;
  head_name: string | null;
  member_count: number;
  adult_count: number;
  child_count: number;
  male_count: number;
  female_count: number;
  ages: string;
  has_wheelchair: boolean;
  has_special_needs: boolean;
  submitted_at: string | null;
  hotel_name: string | null;
  current_match_status: string | null;
};

type MatchRow = {
  id: string;
  guest_family_id: string;
  host_id: string;
  status: string;
  guest_member_count: number;
  notes: string | null;
  confirmed_at: string | null;
  created_at: string;
  accommodation_hosts: { hof_its: string; first_name: string | null; last_name: string | null; address: string | null; city: string | null } | null;
  families: { hof_its: string; hotel_name: string | null } | null;
};

type Suggestion = {
  guest: GuestRow;
  host: HostRow;
  score: number;
  reasons: string[];
};

type AllocationResult = {
  matched: Suggestion[];
  unmatched: GuestRow[];
};

type ScoringToggles = {
  fifo: boolean;
  proximity: boolean;
  demographics: boolean;
};

function adminKey(): string {
  if (typeof window === "undefined") return "";
  return process.env.NEXT_PUBLIC_ADMIN_KEY ?? window.localStorage.getItem("admin_key") ?? "";
}

function headers(): HeadersInit {
  return { "x-admin-key": adminKey() };
}

function exportToXlsx(data: Record<string, unknown>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename);
}

export default function AccommodationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"hosts" | "guests" | "matches" | "suggest">("hosts");
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [allocation, setAllocation] = useState<AllocationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Suggestion view mode
  const [suggestMode, setSuggestMode] = useState<"per-guest" | "allocation">("per-guest");

  // Scoring toggles
  const [scoring, setScoring] = useState<ScoringToggles>({ fifo: true, proximity: true, demographics: true });

  // Algorithm info expanded
  const [showAlgo, setShowAlgo] = useState(false);

  // Auth gate
  const canWrite = (() => {
    if (typeof window === "undefined") return false;
    try {
      const user = JSON.parse(window.localStorage.getItem("admin_user") ?? "null");
      return canManageParking(user);
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    try {
      const user = JSON.parse(window.localStorage.getItem("admin_user") ?? "null");
      if (!canManageParking(user)) {
        router.replace("/admin");
      }
    } catch {
      router.replace("/admin");
    }
  }, [router]);

  function scoringParams(): string {
    const p = new URLSearchParams();
    if (!scoring.fifo) p.set("fifo", "0");
    if (!scoring.proximity) p.set("proximity", "0");
    if (!scoring.demographics) p.set("demographics", "0");
    return p.toString();
  }

  const fetchHosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/accommodations/hosts", { headers: headers() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setHosts(data.hosts ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGuests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/accommodations/guests", { headers: headers() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setGuests(data.guests ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/accommodations/matches", { headers: headers() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMatches(data.matches ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = scoringParams();
      const res = await fetch(`/api/admin/accommodations/matches?action=suggest${sp ? "&" + sp : ""}`, { headers: headers() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoring.fifo, scoring.proximity, scoring.demographics]);

  const fetchAllocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = scoringParams();
      const res = await fetch(`/api/admin/accommodations/matches?action=allocate${sp ? "&" + sp : ""}`, { headers: headers() });
      if (!res.ok) throw new Error(await res.text());
      const data: AllocationResult = await res.json();
      setAllocation(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoring.fifo, scoring.proximity, scoring.demographics]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "hosts") fetchHosts();
    else if (tab === "guests") fetchGuests();
    else if (tab === "matches") fetchMatches();
    else if (tab === "suggest") {
      if (suggestMode === "per-guest") fetchSuggestions();
      else fetchAllocation();
    }
  }, [tab, suggestMode, fetchHosts, fetchGuests, fetchMatches, fetchSuggestions, fetchAllocation]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/accommodations/hosts", {
        method: "POST",
        headers: { "x-admin-key": adminKey() },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSuccessMsg(`Imported ${data.hostsUpserted} hosts from ${data.rows} rows.`);
      form.reset();
      fetchHosts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleFamilyFriends(hostId: string, current: boolean) {
    try {
      const res = await fetch("/api/admin/accommodations/hosts", {
        method: "PATCH",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, include_family_friends: !current }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchHosts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleGeocode(hostId: string) {
    try {
      const res = await fetch("/api/admin/accommodations/hosts", {
        method: "PATCH",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, action: "geocode" }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchHosts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateMatch(guestFamilyId: string, hostId: string, memberCount: number) {
    const ok = window.confirm(
      "This will create a PENDING match linkage only.\n\n" +
      "It does NOT update the guest family's accommodation record.\n" +
      "You must click 'Confirm' on the Matches tab to finalize the assignment and update the family's utaro details.\n\n" +
      "Proceed?"
    );
    if (!ok) return;

    try {
      const res = await fetch("/api/admin/accommodations/matches", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ guestFamilyId, hostId, guestMemberCount: memberCount }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSuccessMsg("Match created (pending)");
      if (suggestMode === "per-guest") fetchSuggestions();
      else fetchAllocation();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleMatchAction(matchId: string, action: "confirm" | "reject" | "cancel") {
    try {
      const res = await fetch("/api/admin/accommodations/matches", {
        method: "PATCH",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, action }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSuccessMsg(`Match ${action}ed`);
      fetchMatches();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // --- Export handlers ---
  function exportHosts() {
    exportToXlsx(hosts.map(h => ({
      Name: h.display_name,
      ITS: h.hof_its,
      City: h.city ?? "",
      "Cap (mehman)": h.capacity_mehman,
      "Cap (F&F)": h.capacity_family_friends,
      "Include F&F": h.include_family_friends ? "Yes" : "No",
      Effective: h.effective_capacity,
      Confirmed: h.confirmed_allocated,
      Pending: h.pending_allocated,
      Remaining: h.remaining_capacity,
      "Gender Pref": h.gender_preference ?? "",
      "Distance (km)": h.distance_to_masjid_km ?? "",
    })), "accommodations-hosts.xlsx");
  }

  function exportGuests() {
    exportToXlsx(guests.map(g => ({
      Name: g.head_name ?? g.hof_its,
      ITS: g.hof_its,
      Members: g.member_count,
      Adults: g.adult_count,
      Children: g.child_count,
      Male: g.male_count,
      Female: g.female_count,
      Ages: g.ages,
      Wheelchair: g.has_wheelchair ? "Yes" : "No",
      Hotel: g.hotel_name ?? "",
      Submitted: g.submitted_at ?? "",
      Status: g.current_match_status ?? "unmatched",
    })), "accommodations-guests.xlsx");
  }

  function exportMatches() {
    exportToXlsx(matches.map(m => ({
      "Guest ITS": m.families?.hof_its ?? m.guest_family_id,
      "Host Name": m.accommodation_hosts ? [m.accommodation_hosts.first_name, m.accommodation_hosts.last_name].filter(Boolean).join(" ") : "",
      "Host ITS": m.accommodation_hosts?.hof_its ?? "",
      Members: m.guest_member_count,
      Status: m.status,
      Created: m.created_at,
      Confirmed: m.confirmed_at ?? "",
    })), "accommodations-matches.xlsx");
  }

  function exportSuggestions() {
    const data = suggestMode === "allocation" && allocation
      ? [...allocation.matched.map(s => ({ ...formatSuggestionRow(s), Matched: "Yes" })), ...allocation.unmatched.map(g => ({ Guest: g.head_name ?? g.hof_its, ITS: g.hof_its, Members: g.member_count, Host: "", Score: "", Reasons: "", Matched: "No" }))]
      : suggestions.slice(0, 500).map(s => formatSuggestionRow(s));
    exportToXlsx(data, `accommodations-suggestions-${suggestMode}.xlsx`);
  }

  function formatSuggestionRow(s: Suggestion) {
    return {
      Guest: s.guest.head_name ?? s.guest.hof_its,
      ITS: s.guest.hof_its,
      Members: s.guest.member_count,
      Host: s.host.display_name,
      "Host ITS": s.host.hof_its,
      "Remaining Cap": s.host.remaining_capacity,
      Score: s.score,
      Reasons: s.reasons.join("; "),
    };
  }

  // --- Group suggestions by guest ---
  function groupByGuest(list: Suggestion[]): Map<string, Suggestion[]> {
    const map = new Map<string, Suggestion[]>();
    for (const s of list) {
      const key = s.guest.family_id;
      const existing = map.get(key) ?? [];
      existing.push(s);
      map.set(key, existing);
    }
    return map;
  }

  const tabCls = (t: string) =>
    `px-4 py-2 rounded-t font-medium text-sm ${
      tab === t ? "bg-white dark:bg-gray-800 border-b-2 border-blue-500" : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
    }`;

  return (
    <div className="max-w-7xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Accommodations</h1>

      {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-3 rounded mb-4">{error}</div>}
      {successMsg && <div className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 p-3 rounded mb-4">{successMsg}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b dark:border-gray-700">
        <button className={tabCls("hosts")} onClick={() => setTab("hosts")}>Hosts ({hosts.length})</button>
        <button className={tabCls("guests")} onClick={() => setTab("guests")}>Awaiting Guests ({guests.length})</button>
        <button className={tabCls("matches")} onClick={() => setTab("matches")}>Matches ({matches.length})</button>
        <button className={tabCls("suggest")} onClick={() => setTab("suggest")}>Suggestions</button>
      </div>

      {loading && <p className="text-gray-500 dark:text-gray-400 animate-pulse">Loading…</p>}

      {/* Hosts Tab */}
      {tab === "hosts" && !loading && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            {canWrite && (
              <form onSubmit={handleUpload} className="flex items-center gap-2">
                <input type="file" name="file" accept=".xlsx,.xls,.csv" required className="text-sm" />
                <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                  Upload Hosts
                </button>
              </form>
            )}
            <button onClick={exportHosts} className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 ml-auto">
              Export XLSX
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b dark:border-gray-700 text-left">
                  <th className="p-2">Name</th>
                  <th className="p-2">ITS</th>
                  <th className="p-2">City</th>
                  <th className="p-2">Cap (mehman)</th>
                  <th className="p-2">Cap (F&F)</th>
                  <th className="p-2">Include F&F</th>
                  <th className="p-2">Effective</th>
                  <th className="p-2">Confirmed</th>
                  <th className="p-2">Pending</th>
                  <th className="p-2">Remaining</th>
                  <th className="p-2">Gender Pref</th>
                  <th className="p-2">Distance</th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((h) => (
                  <tr key={h.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="p-2">{h.display_name}</td>
                    <td className="p-2 font-mono text-xs">{h.hof_its}</td>
                    <td className="p-2">{h.city ?? "—"}</td>
                    <td className="p-2 text-center">{h.capacity_mehman}</td>
                    <td className="p-2 text-center">{h.capacity_family_friends}</td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={h.include_family_friends}
                        onChange={() => handleToggleFamilyFriends(h.id, h.include_family_friends)}
                        disabled={!canWrite}
                      />
                    </td>
                    <td className="p-2 text-center font-semibold">{h.effective_capacity}</td>
                    <td className="p-2 text-center">{h.confirmed_allocated}</td>
                    <td className="p-2 text-center text-yellow-600 dark:text-yellow-400">{h.pending_allocated || ""}</td>
                    <td className="p-2 text-center font-semibold text-green-600 dark:text-green-400">{h.remaining_capacity}</td>
                    <td className="p-2">{h.gender_preference ?? "—"}</td>
                    <td className="p-2">
                      {h.distance_to_masjid_km != null
                        ? `${h.distance_to_masjid_km} km`
                        : canWrite
                          ? <button onClick={() => handleGeocode(h.id)} className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded hover:bg-blue-200" title="Calculate distance from address">📍</button>
                          : "—"
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hosts.length === 0 && <p className="text-gray-500 dark:text-gray-400 p-4 text-center">No hosts imported yet.</p>}
          </div>

          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Total effective capacity: {hosts.reduce((s, h) => s + h.effective_capacity, 0)} |
            Confirmed: {hosts.reduce((s, h) => s + h.confirmed_allocated, 0)} |
            Pending: {hosts.reduce((s, h) => s + h.pending_allocated, 0)} |
            Remaining: {hosts.reduce((s, h) => s + h.remaining_capacity, 0)}
          </div>
        </div>
      )}

      {/* Guests Tab */}
      {tab === "guests" && !loading && (
        <div>
          <div className="flex justify-end mb-2">
            <button onClick={exportGuests} className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm hover:bg-gray-700">
              Export XLSX
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b dark:border-gray-700 text-left">
                  <th className="p-2">HOF Name</th>
                  <th className="p-2">ITS</th>
                  <th className="p-2">Members</th>
                  <th className="p-2">Adults/Kids</th>
                  <th className="p-2">M/F</th>
                  <th className="p-2">Ages</th>
                  <th className="p-2">Wheelchair</th>
                  <th className="p-2">Hotel</th>
                  <th className="p-2">Submitted</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((g) => (
                  <tr key={g.family_id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="p-2">{g.head_name ?? "—"}</td>
                    <td className="p-2 font-mono text-xs">{g.hof_its}</td>
                    <td className="p-2 text-center">{g.member_count}</td>
                    <td className="p-2 text-center">{g.adult_count}/{g.child_count}</td>
                    <td className="p-2 text-center">{g.male_count}M/{g.female_count}F</td>
                    <td className="p-2 text-xs">{g.ages || "—"}</td>
                    <td className="p-2 text-center">{g.has_wheelchair ? "♿" : ""}</td>
                    <td className="p-2">{g.hotel_name ?? "—"}</td>
                    <td className="p-2 text-xs">{g.submitted_at ? new Date(g.submitted_at).toLocaleDateString() : "—"}</td>
                    <td className="p-2">
                      {g.current_match_status ? (
                        <span className={`px-1.5 py-0.5 rounded text-xs ${g.current_match_status === "confirmed" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"}`}>
                          {g.current_match_status}
                        </span>
                      ) : (
                        <span className="text-gray-400">unmatched</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {guests.length === 0 && <p className="text-gray-500 dark:text-gray-400 p-4 text-center">No awaiting guests found.</p>}
          </div>
        </div>
      )}

      {/* Matches Tab */}
      {tab === "matches" && !loading && (
        <div>
          <div className="flex justify-end mb-2">
            <button onClick={exportMatches} className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm hover:bg-gray-700">
              Export XLSX
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b dark:border-gray-700 text-left">
                  <th className="p-2">Guest</th>
                  <th className="p-2">Guest ITS</th>
                  <th className="p-2">Members</th>
                  <th className="p-2">Host</th>
                  <th className="p-2">Host ITS</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Created</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="p-2 font-medium">{m.families?.hof_its ?? m.guest_family_id.slice(0, 8)}</td>
                    <td className="p-2 font-mono text-xs">{m.families?.hof_its ?? "—"}</td>
                    <td className="p-2 text-center">{m.guest_member_count}</td>
                    <td className="p-2 font-medium">{m.accommodation_hosts ? [m.accommodation_hosts.first_name, m.accommodation_hosts.last_name].filter(Boolean).join(" ") || m.accommodation_hosts.hof_its : m.host_id.slice(0, 8)}</td>
                    <td className="p-2 font-mono text-xs">{m.accommodation_hosts?.hof_its ?? "—"}</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        m.status === "confirmed" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                        m.status === "pending" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" :
                        "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                      }`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="p-2 text-xs">{new Date(m.created_at).toLocaleDateString()}</td>
                    <td className="p-2 space-x-1">
                      {canWrite && m.status === "pending" && (
                        <>
                          <button onClick={() => handleMatchAction(m.id, "confirm")} className="px-2 py-0.5 text-xs bg-green-600 text-white rounded hover:bg-green-700">
                            Confirm
                          </button>
                          <button onClick={() => handleMatchAction(m.id, "reject")} className="px-2 py-0.5 text-xs bg-red-600 text-white rounded hover:bg-red-700">
                            Reject
                          </button>
                        </>
                      )}
                      {canWrite && m.status === "confirmed" && (
                        <button onClick={() => handleMatchAction(m.id, "cancel")} className="px-2 py-0.5 text-xs bg-gray-600 text-white rounded hover:bg-gray-700">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {matches.length === 0 && <p className="text-gray-500 dark:text-gray-400 p-4 text-center">No matches yet.</p>}
          </div>
        </div>
      )}

      {/* Suggestions Tab */}
      {tab === "suggest" && !loading && (
        <div>
          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Mode toggle */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded p-0.5">
              <button
                className={`px-3 py-1 text-xs rounded ${suggestMode === "per-guest" ? "bg-white dark:bg-gray-700 shadow font-semibold" : ""}`}
                onClick={() => setSuggestMode("per-guest")}
              >
                Per Guest
              </button>
              <button
                className={`px-3 py-1 text-xs rounded ${suggestMode === "allocation" ? "bg-white dark:bg-gray-700 shadow font-semibold" : ""}`}
                onClick={() => setSuggestMode("allocation")}
              >
                Best Allocation
              </button>
            </div>

            {/* Scoring toggles */}
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={scoring.fifo} onChange={(e) => setScoring(s => ({ ...s, fifo: e.target.checked }))} />
                FIFO
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={scoring.proximity} onChange={(e) => setScoring(s => ({ ...s, proximity: e.target.checked }))} />
                Proximity
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={scoring.demographics} onChange={(e) => setScoring(s => ({ ...s, demographics: e.target.checked }))} />
                Demographics
              </label>
            </div>

            {/* Rerun button */}
            <button
              onClick={() => suggestMode === "per-guest" ? fetchSuggestions() : fetchAllocation()}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              Re-run
            </button>

            {/* Export */}
            <button onClick={exportSuggestions} className="px-3 py-1.5 bg-gray-600 text-white rounded text-xs hover:bg-gray-700 ml-auto">
              Export XLSX
            </button>

            {/* Algorithm info toggle */}
            <button onClick={() => setShowAlgo(!showAlgo)} className="text-xs text-blue-600 dark:text-blue-400 underline">
              {showAlgo ? "Hide" : "Show"} Algorithm
            </button>
          </div>

          {/* Algorithm explanation */}
          {showAlgo && (
            <div className="bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded p-3 mb-4 text-xs space-y-1">
              <p className="font-semibold">Scoring Formula (max 100 points):</p>
              <ul className="list-disc ml-4 space-y-0.5">
                <li><strong>FIFO (40 pts)</strong> — Earlier registration → higher score. Rank 1 of N gets 40, last gets 0.{!scoring.fifo && <span className="text-red-500 ml-1">[OFF]</span>}</li>
                <li><strong>Proximity to Masjid (30 pts)</strong> — Host within 0km = 30 pts, linearly to 0 at 30km.{!scoring.proximity && <span className="text-red-500 ml-1">[OFF]</span>}</li>
                <li><strong>Demographics/Mobility (15 pts)</strong> — Wheelchair/special needs guests get bonus for spacious hosts (10) and senior host households (5).{!scoring.demographics && <span className="text-red-500 ml-1">[OFF]</span>}</li>
                <li><strong>Gender Preference (15 pts, always on)</strong> — Host mardo/bairo preference matched to guest M/F ratio (15) or flexible host (10).</li>
              </ul>
              <p className="mt-2 text-gray-500">
                <strong>Per Guest</strong> mode: shows all eligible host options per guest, ranked by score.<br/>
                <strong>Best Allocation</strong> mode: maximizes families matched using smallest-first bin-packing. FIFO is disabled in this mode. Unmatched families are highlighted.
              </p>
              <p className="text-gray-500">Results are deterministic — same data and settings produce the same output.</p>
            </div>
          )}

          {/* Per-Guest View */}
          {suggestMode === "per-guest" && (
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Top host options per guest family. {suggestions.length} total pairs found.
              </p>
              <div className="space-y-4">
                {Array.from(groupByGuest(suggestions)).map(([familyId, familySuggestions]) => (
                  <div key={familyId} className="border dark:border-gray-700 rounded p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold">{familySuggestions[0].guest.head_name ?? familySuggestions[0].guest.hof_its}</span>
                      <span className="text-xs text-gray-500">({familySuggestions[0].guest.member_count} members)</span>
                      <span className="text-xs font-mono text-gray-400">{familySuggestions[0].guest.hof_its}</span>
                      {familySuggestions[0].guest.has_wheelchair && <span>♿</span>}
                    </div>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-left border-b dark:border-gray-700">
                          <th className="p-1">Score</th>
                          <th className="p-1">Host</th>
                          <th className="p-1">Remaining</th>
                          <th className="p-1">Distance</th>
                          <th className="p-1">Reasons</th>
                          <th className="p-1">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {familySuggestions.slice(0, 5).map((s, i) => (
                          <tr key={`${s.host.id}-${i}`} className="border-b dark:border-gray-700/50">
                            <td className="p-1 font-mono font-semibold">{s.score}</td>
                            <td className="p-1">{s.host.display_name}</td>
                            <td className="p-1 text-center text-green-600">{s.host.remaining_capacity}</td>
                            <td className="p-1">{s.host.distance_to_masjid_km != null ? `${s.host.distance_to_masjid_km}km` : "—"}</td>
                            <td className="p-1 text-gray-500">{s.reasons.join("; ")}</td>
                            <td className="p-1">
                              {canWrite && (
                                <button
                                  onClick={() => handleCreateMatch(s.guest.family_id, s.host.id, s.guest.member_count)}
                                  className="px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                  Match
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {familySuggestions.length > 5 && (
                      <p className="text-xs text-gray-400 mt-1">+{familySuggestions.length - 5} more options</p>
                    )}
                  </div>
                ))}
                {suggestions.length === 0 && <p className="text-gray-500 dark:text-gray-400 p-4 text-center">No suggestions available.</p>}
              </div>
            </div>
          )}

          {/* Best Allocation View */}
          {suggestMode === "allocation" && allocation && (
            <div>
              <div className="flex items-center gap-4 mb-3 text-sm">
                <span className="text-green-700 dark:text-green-400 font-semibold">
                  Matched: {allocation.matched.length} families
                </span>
                {allocation.unmatched.length > 0 && (
                  <span className="text-red-600 dark:text-red-400 font-semibold">
                    Unmatched: {allocation.unmatched.length} families
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b dark:border-gray-700 text-left">
                      <th className="p-2">Status</th>
                      <th className="p-2">Guest</th>
                      <th className="p-2">Members</th>
                      <th className="p-2">Host</th>
                      <th className="p-2">Score</th>
                      <th className="p-2">Reasons</th>
                      <th className="p-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocation.matched.map((s, i) => (
                      <tr key={`m-${i}`} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="p-2"><span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">matched</span></td>
                        <td className="p-2">{s.guest.head_name ?? s.guest.hof_its}</td>
                        <td className="p-2 text-center">{s.guest.member_count}</td>
                        <td className="p-2">{s.host.display_name}</td>
                        <td className="p-2 font-mono">{s.score}</td>
                        <td className="p-2 text-xs">{s.reasons.join("; ")}</td>
                        <td className="p-2">
                          {canWrite && (
                            <button
                              onClick={() => handleCreateMatch(s.guest.family_id, s.host.id, s.guest.member_count)}
                              className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Match
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {allocation.unmatched.map((g, i) => (
                      <tr key={`u-${i}`} className="border-b dark:border-gray-700 bg-red-50 dark:bg-red-900/20">
                        <td className="p-2"><span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">unmatched</span></td>
                        <td className="p-2 text-red-700 dark:text-red-300">{g.head_name ?? g.hof_its}</td>
                        <td className="p-2 text-center text-red-700 dark:text-red-300">{g.member_count}</td>
                        <td className="p-2 text-gray-400">—</td>
                        <td className="p-2 text-gray-400">—</td>
                        <td className="p-2 text-xs text-red-600 dark:text-red-400">No host with sufficient capacity</td>
                        <td className="p-2"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {allocation.matched.length === 0 && allocation.unmatched.length === 0 && (
                  <p className="text-gray-500 dark:text-gray-400 p-4 text-center">No guests to allocate.</p>
                )}
              </div>
            </div>
          )}
          {suggestMode === "allocation" && !allocation && (
            <p className="text-gray-500 dark:text-gray-400 p-4 text-center">No allocation data.</p>
          )}
        </div>
      )}
    </div>
  );
}
