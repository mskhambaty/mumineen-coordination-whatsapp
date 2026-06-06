"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { canManageParking, canViewParking } from "@/lib/admin/access";
import {
  LOT_PURPOSES,
  PURPOSE_LABELS,
  SUGGESTED_COLORS,
  type HouseholdRow,
} from "@/lib/parking/rollups";

type Lot = {
  id: string;
  name: string;
  capacity: number;
  color: string | null;
  purposes: string[];
  sort_order: number;
  assigned: number;
};

// Server-side filters (each change re-fetches). The name search is intentionally NOT
// here — it filters the loaded rows client-side so typing doesn't refetch per keystroke.
type Filters = {
  eligible: boolean;
  local_mehman: string;
  rahat_senior: boolean;
  all_65: boolean;
  categories: string[];
  kids_under_7: boolean;
  assigned: string;
};

const DEFAULT_FILTERS: Filters = {
  eligible: true,
  local_mehman: "",
  rahat_senior: false,
  all_65: false,
  categories: [],
  kids_under_7: false,
  assigned: "",
};

// Pass colors are free text; map the known names to swatch colors for the chips.
const COLOR_SWATCH: Record<string, string> = {
  blue: "#3b82f6",
  yellow: "#eab308",
  gold: "#d4a017",
  green: "#22c55e",
  orchid: "#da70d6",
  pink: "#ec4899",
  cream: "#fffdd0",
  white: "#ffffff",
};

function swatch(color: string | null): string {
  return COLOR_SWATCH[(color ?? "").toLowerCase()] ?? "#9ca3af";
}

function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-gray-300 dark:border-gray-600"
      style={{ backgroundColor: swatch(color) }}
    />
  );
}

function Badge({ label, tone }: { label: string; tone?: "blue" | "amber" | "gray" }) {
  const cls =
    tone === "blue"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

// ─── Lot card ──────────────────────────────────────────────────────────────────

function LotCard({
  lot,
  canManage,
  onSave,
}: {
  lot: Lot;
  canManage: boolean;
  onSave: (patch: { id: string; capacity: number; color: string; purposes: string[] }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [capacity, setCapacity] = useState(String(lot.capacity));
  const [color, setColor] = useState(lot.color ?? "");
  const [purposes, setPurposes] = useState<string[]>(lot.purposes);
  const [saving, setSaving] = useState(false);

  const over = lot.capacity > 0 && lot.assigned > lot.capacity;
  const full = lot.capacity > 0 && lot.assigned === lot.capacity;

  async function save() {
    setSaving(true);
    try {
      await onSave({ id: lot.id, capacity: Number(capacity) || 0, color, purposes });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ColorDot color={lot.color} />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{lot.name}</span>
        </div>
        <span
          className={`text-sm font-bold tabular-nums ${
            over ? "text-red-500" : full ? "text-amber-500" : "text-gray-700 dark:text-gray-200"
          }`}
        >
          {lot.assigned}/{lot.capacity}
        </span>
      </div>
      {lot.purposes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {lot.purposes.map((p) => (
            <Badge key={p} label={PURPOSE_LABELS[p] ?? p} />
          ))}
        </div>
      )}
      {canManage && !editing && (
        <button
          type="button"
          onClick={() => {
            setCapacity(String(lot.capacity));
            setColor(lot.color ?? "");
            setPurposes(lot.purposes);
            setEditing(true);
          }}
          className="mt-2 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
        >
          Edit
        </button>
      )}
      {editing && (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2 dark:border-gray-700">
          <label className="block text-[11px] text-gray-500 dark:text-gray-400">
            Capacity
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="block text-[11px] text-gray-500 dark:text-gray-400">
            Pass color
            <input
              type="text"
              list="pass-colors"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. Blue"
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            Purposes
            <div className="mt-1 space-y-1">
              {LOT_PURPOSES.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={purposes.includes(p)}
                    onChange={(e) =>
                      setPurposes(e.target.checked ? [...purposes, p] : purposes.filter((x) => x !== p))
                    }
                  />
                  {PURPOSE_LABELS[p]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 dark:border-gray-600 dark:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Assign dropdown ───────────────────────────────────────────────────────────

function AssignMenu({
  lots,
  onAssign,
  onClose,
}: {
  lots: Lot[];
  onAssign: (lotId: string, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-md border bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional, e.g. extra pass reason)"
        className="mb-1.5 w-full rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
      />
      <div className="max-h-56 overflow-y-auto">
        {lots.map((lot) => {
          const remaining = lot.capacity - lot.assigned;
          const overOrFull = lot.capacity > 0 && remaining <= 0;
          return (
            <button
              key={lot.id}
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onAssign(lot.id, notes);
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <span className="flex items-center gap-1.5">
                <ColorDot color={lot.color} />
                {lot.name}
              </span>
              <span className={overOrFull ? "font-semibold text-red-500" : "text-gray-400"}>
                {overOrFull ? "full" : `${remaining} left`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ParkingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [userId, setUserId] = useState("");

  const [lots, setLots] = useState<Lot[]>([]);
  const [rows, setRows] = useState<HouseholdRow[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState(""); // client-side head-name filter, no refetch
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null); // family_id with open assign menu

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";
  const headers = useMemo(
    () => ({ "x-admin-key": adminKey, "x-admin-user-id": userId }),
    [adminKey, userId],
  );

  // Gate: signed-in portal user with parking view access (see canViewParking).
  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const raw = localStorage.getItem("admin_user");
    const user = raw ? JSON.parse(raw) : null;
    if (!canViewParking(user)) {
      router.push("/admin/conversations");
      return;
    }
    setCanManage(canManageParking(user));
    setUserId(user?.id ?? "");
    setReady(true);
  }, [router]);

  const loadLots = useCallback(async () => {
    const res = await fetch("/api/admin/parking/lots", { headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Failed to load lots");
    setLots(json.lots ?? []);
  }, [headers]);

  const loadHouseholds = useCallback(
    async (f: Filters) => {
      const params = new URLSearchParams();
      if (f.eligible) params.set("eligible", "1");
      if (f.local_mehman) params.set("local_mehman", f.local_mehman);
      if (f.rahat_senior) params.set("rahat_senior", "1");
      if (f.all_65) params.set("all_65", "1");
      if (f.categories.length > 0) params.set("categories", f.categories.join(","));
      if (f.kids_under_7) params.set("kids_under_7", "1");
      if (f.assigned) params.set("assigned", f.assigned);
      const res = await fetch(`/api/admin/parking/households?${params}`, { headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load households");
      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
      setCategories(json.categories ?? []);
    },
    [headers],
  );

  const loadAll = useCallback(
    async (f: Filters) => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadLots(), loadHouseholds(f)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [loadLots, loadHouseholds],
  );

  useEffect(() => {
    if (ready && userId) void loadAll(DEFAULT_FILTERS);
    // Initial load once gated; subsequent loads go through applyFilter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId]);

  function applyFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void loadAll(next);
  }

  async function assignPass(familyId: string, lotId: string, notes: string) {
    const res = await fetch("/api/admin/parking/passes", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: familyId, lot_id: lotId, notes }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Failed to assign pass");
      return;
    }
    await loadAll(filters);
  }

  async function revokePass(passId: string) {
    const res = await fetch(`/api/admin/parking/passes?id=${encodeURIComponent(passId)}`, {
      method: "DELETE",
      headers,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Failed to revoke pass");
      return;
    }
    await loadAll(filters);
  }

  async function saveLot(patch: { id: string; capacity: number; color: string; purposes: string[] }) {
    const res = await fetch("/api/admin/parking/lots", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Failed to save lot");
      return;
    }
    await loadLots();
  }

  // Rows shown in the table: server-filtered set, narrowed by the client-side name search.
  const visible = useMemo(
    () => (search ? rows.filter((r) => r.head_name.toLowerCase().includes(search.toLowerCase())) : rows),
    [rows, search],
  );

  // One CSV row per pass across the currently visible households.
  function exportCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = ["Household", "Phone", "Lot", "Color"];
    const lines = visible.flatMap((r) =>
      r.passes.map((p) => [r.head_name, r.phone ?? "", p.lot_name, p.lot_color ?? ""].map(esc).join(",")),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parking-passes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!ready) return null;

  const passCount = visible.reduce((n, r) => n + r.passes.length, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <datalist id="pass-colors">
        {SUGGESTED_COLORS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Parking Passes</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {canManage ? "Assign lot passes to households and export for printing." : "Read-only view."}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading || passCount === 0}
            title="Exports one row per pass for the households currently shown"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Export CSV ({passCount} passes)
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Lot dashboard */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {lots.map((lot) => (
          <LotCard key={lot.id} lot={lot} canManage={canManage} onSave={saveLot} />
        ))}
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => applyFilter({ eligible: !filters.eligible })}
          className={`rounded-full border px-2.5 py-1 ${
            filters.eligible
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300"
          }`}
        >
          Eligible (local or mehman w/ rental)
        </button>
        <select
          value={filters.local_mehman}
          onChange={(e) => applyFilter({ local_mehman: e.target.value })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">Local + Mehman</option>
          <option value="Local">Local</option>
          <option value="Mehman">Mehman</option>
        </select>
        <button
          type="button"
          onClick={() => applyFilter({ rahat_senior: !filters.rahat_senior })}
          className={`rounded-full border px-2.5 py-1 ${
            filters.rahat_senior
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300"
          }`}
        >
          Rahat / 65+ member
        </button>
        <button
          type="button"
          onClick={() => applyFilter({ all_65: !filters.all_65 })}
          className={`rounded-full border px-2.5 py-1 ${
            filters.all_65
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300"
          }`}
        >
          All members 65+
        </button>
        <button
          type="button"
          onClick={() => applyFilter({ kids_under_7: !filters.kids_under_7 })}
          className={`rounded-full border px-2.5 py-1 ${
            filters.kids_under_7
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300"
          }`}
        >
          Kids under 7
        </button>
        <select
          value={filters.categories[0] ?? ""}
          onChange={(e) => applyFilter({ categories: e.target.value ? [e.target.value] : [] })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">Any category</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filters.assigned}
          onChange={(e) => applyFilter({ assigned: e.target.value })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">Assigned + unassigned</option>
          <option value="assigned">Assigned</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search household head…"
          className="min-w-44 rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        />
        <span className="ml-auto text-gray-400">
          {loading ? "Loading…" : `${visible.length} of ${total} households`}
        </span>
      </div>

      {/* Household table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <th className="px-3 py-2">Household</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Criteria</th>
              <th className="px-3 py-2">Passes</th>
              {canManage && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
            {visible.map((r) => (
              <tr key={r.family_id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900 dark:text-white">{r.head_name}</div>
                  <div className="text-[11px] text-gray-400">
                    {r.hof_its} · {r.member_count} member{r.member_count === 1 ? "" : "s"}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-700 dark:text-gray-300">{r.local_mehman ?? "—"}</span>
                    {!r.eligible && <Badge label="Not eligible" tone="amber" />}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{r.phone ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.rahat_count > 0 && <Badge label={`Rahat ×${r.rahat_count}`} tone="blue" />}
                    {r.senior_count > 0 && !r.all_65_plus && <Badge label={`65+ ×${r.senior_count}`} tone="blue" />}
                    {r.all_65_plus && <Badge label="All 65+" tone="blue" />}
                    {r.categories.map((c) => (
                      <Badge key={c} label={c} tone="blue" />
                    ))}
                    {r.kids_under_7 > 0 && <Badge label={`Kids <7 ×${r.kids_under_7}`} />}
                    {r.transport_mode === "rental" && <Badge label="Rental" />}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.passes.length === 0 && <span className="text-xs text-gray-400">—</span>}
                    {r.passes.map((p) => (
                      <span
                        key={p.id}
                        title={p.notes ?? undefined}
                        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-300"
                      >
                        <ColorDot color={p.lot_color} />
                        {p.lot_name}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void revokePass(p.id)}
                            className="text-gray-400 hover:text-red-500"
                            aria-label={`Revoke ${p.lot_name} pass`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </td>
                {canManage && (
                  <td className="relative px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setAssignFor(assignFor === r.family_id ? null : r.family_id)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Assign
                    </button>
                    {assignFor === r.family_id && (
                      <AssignMenu
                        lots={lots}
                        onAssign={(lotId, notes) => assignPass(r.family_id, lotId, notes)}
                        onClose={() => setAssignFor(null)}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-3 py-8 text-center text-sm text-gray-400">
                  No households match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
