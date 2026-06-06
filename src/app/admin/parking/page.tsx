"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { canManageParking, canViewParking } from "@/lib/admin/access";
import {
  LOT_PURPOSES,
  PURPOSE_LABELS,
  SUGGESTED_COLORS,
  lotPurposesNarrow,
  matchesLotPurposes,
  pickAssignable,
  type HouseholdRow,
} from "@/lib/parking/rollups";

const PAGE_SIZE = 50;

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
  all_rahat: boolean;
  all_65: boolean;
  wheelchair: boolean;
  has_phone: boolean;
  has_category: boolean;
  kids_under_7: boolean;
  assigned: string;
};

const DEFAULT_FILTERS: Filters = {
  eligible: true,
  local_mehman: "",
  rahat_senior: false,
  all_rahat: false,
  all_65: false,
  wheelchair: false,
  has_phone: false,
  has_category: false,
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

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 ${
        active
          ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          : "border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300"
      }`}
    >
      {label}
    </button>
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
  onSave: (patch: { id: string; name: string; capacity: number; color: string; purposes: string[] }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lot.name);
  const [capacity, setCapacity] = useState(String(lot.capacity));
  const [color, setColor] = useState(lot.color ?? "");
  const [purposes, setPurposes] = useState<string[]>(lot.purposes);
  const [saving, setSaving] = useState(false);

  const over = lot.capacity > 0 && lot.assigned > lot.capacity;
  const full = lot.capacity > 0 && lot.assigned === lot.capacity;

  async function save() {
    setSaving(true);
    try {
      // Stay in edit mode on failure (e.g. duplicate name) so the input isn't lost.
      const ok = await onSave({ id: lot.id, name: name.trim(), capacity: Number(capacity) || 0, color, purposes });
      if (ok) setEditing(false);
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
            setName(lot.name);
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
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
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
              disabled={saving || !name.trim()}
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
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState(""); // client-side head-name filter, no refetch
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // bulk-assign result message
  const [assignFor, setAssignFor] = useState<string | null>(null); // family_id with open assign menu
  const [page, setPage] = useState(1);
  // Bulk "fill lot" flow: selection spans pages and survives search narrowing; it clears
  // on server-filter changes (the set it was built against changed) and after an assign.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLotId, setBulkLotId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Auto-narrow the list to households fitting the target lot's purposes. Turned on
  // when a narrowable lot is picked; the chip stays toggleable for deliberate overrides.
  const [purposeFit, setPurposeFit] = useState(false);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      if (f.all_rahat) params.set("all_rahat", "1");
      if (f.all_65) params.set("all_65", "1");
      if (f.wheelchair) params.set("wheelchair", "1");
      if (f.has_phone) params.set("has_phone", "1");
      if (f.has_category) params.set("has_category", "1");
      if (f.kids_under_7) params.set("kids_under_7", "1");
      if (f.assigned) params.set("assigned", f.assigned);
      const res = await fetch(`/api/admin/parking/households?${params}`, { headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load households");
      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready && userId) void loadAll(DEFAULT_FILTERS);
    // Initial load once gated; subsequent loads go through applyFilter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId]);

  function applyFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    setPage(1);
    setSelected(new Set()); // selection was built against the previous filtered set
    setNotice(null);
    void loadAll(next);
  }

  function toggleSelected(familyId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
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

  async function saveLot(patch: { id: string; name: string; capacity: number; color: string; purposes: string[] }) {
    const res = await fetch("/api/admin/parking/lots", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Failed to save lot");
      return false;
    }
    setError(null);
    // Reload households too — pass chips display the lot name, which may have changed.
    await loadAll(filters);
    return true;
  }

  const bulkLot = lots.find((l) => l.id === bulkLotId) ?? null;
  const bulkRemaining = bulkLot ? Math.max(0, bulkLot.capacity - bulkLot.assigned) : 0;
  const bulkLotNarrows = bulkLot !== null && lotPurposesNarrow(bulkLot.purposes);

  // Rows shown in the table: server-filtered set, narrowed client-side by the name
  // search and (when active) the target lot's purpose fit — both AND with the chips.
  const visible = useMemo(() => {
    let v = rows;
    if (purposeFit && bulkLot && bulkLot.purposes.length > 0) {
      v = v.filter((r) => matchesLotPurposes(r, bulkLot.purposes));
    }
    if (search) {
      v = v.filter((r) => r.head_name.toLowerCase().includes(search.toLowerCase()));
    }
    return v;
  }, [rows, search, purposeFit, bulkLot]);

  // Pagination is purely visual — selection, the capacity meter, and CSV export all
  // operate on the full filtered set. safePage derives the clamp (e.g. when a search
  // shrinks the set below the current page) instead of correcting state in an effect.
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visible, safePage],
  );

  // Picking a target lot kicks off the fill-lot flow: default the list to unassigned
  // households and (when the lot's purposes can narrow) auto-enable the purpose-fit chip.
  function chooseBulkLot(lotId: string) {
    setBulkLotId(lotId);
    const lot = lots.find((l) => l.id === lotId) ?? null;
    setPurposeFit(Boolean(lot && lotPurposesNarrow(lot.purposes)));
    if (lot) {
      applyFilter({ assigned: "unassigned" });
    }
  }

  // Bulk flow derived state. effectiveNew counts only selections that would consume a
  // space in the chosen lot (already-in-lot households get skipped server-side too).
  const rowByFamily = useMemo(() => new Map(rows.map((r) => [r.family_id, r])), [rows]);
  const effectiveNew = useMemo(() => {
    if (!bulkLot) return 0;
    let n = 0;
    for (const id of selected) {
      const row = rowByFamily.get(id);
      if (row && !row.passes.some((p) => p.lot_id === bulkLot.id)) n++;
    }
    return n;
  }, [selected, rowByFamily, bulkLot]);
  const overBy = Math.max(0, effectiveNew - bulkRemaining);

  // Selected households that don't fit the target lot's designated purposes —
  // surfaced as a warning in the bulk bar, never a block.
  const unqualified = useMemo(() => {
    if (!bulkLot || bulkLot.purposes.length === 0) return 0;
    let n = 0;
    for (const id of selected) {
      const row = rowByFamily.get(id);
      if (row && !matchesLotPurposes(row, bulkLot.purposes)) n++;
    }
    return n;
  }, [selected, rowByFamily, bulkLot]);

  async function bulkAssign() {
    if (!bulkLot || selected.size === 0) return;
    if (
      overBy > 0 &&
      !window.confirm(
        `This assigns ${overBy} more pass${overBy === 1 ? "" : "es"} than ${bulkLot.name} has remaining. Proceed?`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/parking/passes/bulk", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ lot_id: bulkLot.id, family_ids: [...selected] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Bulk assign failed");
        return;
      }
      setNotice(
        `Assigned ${json.assigned} pass${json.assigned === 1 ? "" : "es"} to ${bulkLot.name}` +
          (json.skipped > 0 ? `; skipped ${json.skipped} already in this lot.` : "."),
      );
      setSelected(new Set());
      await loadAll(filters);
    } finally {
      setBulkBusy(false);
    }
  }

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
      {notice && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300">
          {notice}
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
        <FilterChip
          active={filters.eligible}
          label="Eligible (local or mehman w/ rental)"
          onClick={() => applyFilter({ eligible: !filters.eligible })}
        />
        <select
          value={filters.local_mehman}
          onChange={(e) => applyFilter({ local_mehman: e.target.value })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">Local + Mehman</option>
          <option value="Local">Local</option>
          <option value="Mehman">Mehman</option>
        </select>
        <FilterChip
          active={filters.rahat_senior}
          label="Any rahat/65+ member"
          onClick={() => applyFilter({ rahat_senior: !filters.rahat_senior })}
        />
        <FilterChip
          active={filters.all_rahat}
          label="All rahat members"
          onClick={() => applyFilter({ all_rahat: !filters.all_rahat })}
        />
        <FilterChip
          active={filters.all_65}
          label="All members 65+"
          onClick={() => applyFilter({ all_65: !filters.all_65 })}
        />
        <FilterChip
          active={filters.wheelchair}
          label="Needs wheelchair"
          onClick={() => applyFilter({ wheelchair: !filters.wheelchair })}
        />
        <FilterChip
          active={filters.kids_under_7}
          label="With kids under 7"
          onClick={() => applyFilter({ kids_under_7: !filters.kids_under_7 })}
        />
        <FilterChip
          active={filters.has_phone}
          label="Phone available"
          onClick={() => applyFilter({ has_phone: !filters.has_phone })}
        />
        <FilterChip
          active={filters.has_category}
          label="VIP"
          onClick={() => applyFilter({ has_category: !filters.has_category })}
        />
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
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search household head…"
          className="min-w-44 rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        />
        <span className="ml-auto text-gray-400">
          {loading ? "Loading…" : `${visible.length} of ${total} households`}
        </span>
      </div>

      {/* Bulk "fill lot" bar */}
      {canManage && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/50">
          <span className="font-semibold text-gray-700 dark:text-gray-200">Bulk assign</span>
          <select
            value={bulkLotId}
            onChange={(e) => chooseBulkLot(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">Choose lot…</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} — {Math.max(0, l.capacity - l.assigned)} of {l.capacity} remaining
              </option>
            ))}
          </select>
          {bulkLotNarrows && bulkLot && (
            <FilterChip
              active={purposeFit}
              label={`Fits lot purposes (${bulkLot.purposes.map((p) => PURPOSE_LABELS[p] ?? p).join(", ")})`}
              onClick={() => setPurposeFit(!purposeFit)}
            />
          )}
          {bulkLot && (
            <>
              <button
                type="button"
                onClick={() => setSelected(new Set(pickAssignable(visible, bulkLot.id, bulkRemaining)))}
                className="rounded-md border border-blue-400 px-2.5 py-1 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
              >
                Select up to remaining ({bulkRemaining})
              </button>
              <span
                className={
                  overBy > 0
                    ? "font-semibold text-red-600 dark:text-red-400"
                    : effectiveNew > 0 && effectiveNew === bulkRemaining
                      ? "font-semibold text-amber-600 dark:text-amber-400"
                      : "text-gray-500 dark:text-gray-400"
                }
              >
                {effectiveNew} new / {bulkRemaining} remaining
                {overBy > 0 ? ` — ${overBy} over` : ""}
              </span>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-gray-400 hover:underline"
                >
                  Clear
                </button>
              )}
              {unqualified > 0 && (
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {`⚠ ${unqualified} of ${selected.size} selected ${
                    unqualified === 1 ? "doesn't" : "don't"
                  } match this lot's purposes (${bulkLot.purposes.map((p) => PURPOSE_LABELS[p] ?? p).join(", ")})`}
                </span>
              )}
              <button
                type="button"
                onClick={() => void bulkAssign()}
                disabled={bulkBusy || selected.size === 0}
                className={`ml-auto rounded-md px-3 py-1.5 font-medium text-white disabled:opacity-50 ${
                  overBy > 0 ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {bulkBusy
                  ? "Assigning…"
                  : `Assign ${selected.size} → ${bulkLot.name}${overBy > 0 ? ` (${overBy} over capacity)` : ""}`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Household table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {canManage && <th className="w-8 px-3 py-2" aria-label="Select" />}
              <th className="px-3 py-2">Household</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Criteria</th>
              <th className="px-3 py-2">Passes</th>
              {canManage && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
            {paged.map((r) => (
              <tr key={r.family_id}>
                {canManage && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.family_id)}
                      onChange={() => toggleSelected(r.family_id)}
                      aria-label={`Select ${r.head_name}`}
                    />
                  </td>
                )}
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
                    {r.rahat_count > 0 && !r.all_rahat && <Badge label={`Rahat ×${r.rahat_count}`} tone="blue" />}
                    {r.all_rahat && <Badge label="All rahat" tone="blue" />}
                    {r.wheelchair_count > 0 && <Badge label={`Wheelchair ×${r.wheelchair_count}`} tone="blue" />}
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
                <td colSpan={canManage ? 7 : 5} className="px-3 py-8 text-center text-sm text-gray-400">
                  No households match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination (visual only — selection and export span all pages) */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-xs text-gray-600 dark:text-gray-300">
          <button
            type="button"
            disabled={safePage === 1}
            onClick={() => setPage(safePage - 1)}
            className="rounded-md border border-gray-300 px-2.5 py-1 disabled:opacity-40 dark:border-gray-600"
          >
            Previous
          </button>
          <span>
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage === totalPages}
            onClick={() => setPage(safePage + 1)}
            className="rounded-md border border-gray-300 px-2.5 py-1 disabled:opacity-40 dark:border-gray-600"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
