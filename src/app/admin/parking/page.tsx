"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { canManageParking, canViewParking, isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import { proximityConflict } from "@/lib/parking/proximity";
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
  eligible: boolean | null;
  local_mehman: string;
  filterMode: "and" | "or";
  // Tri-state: null = off, true = must match, false = must NOT match.
  any_rahat: boolean | null;
  any_senior: boolean | null;
  all_rahat: boolean | null;
  all_65: boolean | null;
  wheelchair: boolean | null;
  has_phone: boolean | null;
  has_category: boolean | null;
  kids_under_7: boolean | null;
  unprinted_passes: boolean | null;
  assigned: string;
};

const DEFAULT_FILTERS: Filters = {
  eligible: true, // default: show only eligible households
  local_mehman: "",
  filterMode: "and",
  any_rahat: null,
  any_senior: null,
  all_rahat: null,
  all_65: null,
  wheelchair: null,
  has_phone: null,
  has_category: null,
  kids_under_7: null,
  unprinted_passes: null,
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
  red: "#ef4444",
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

function FilterChip({
  active,
  label,
  onClick,
  negative,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  negative?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 ${
        active
          ? negative
            ? "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            : "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
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
  canDelete,
  onSave,
  onDelete,
}: {
  lot: Lot;
  canManage: boolean;
  canDelete: boolean;
  onSave: (patch: { id: string; name: string; capacity: number; color: string; purposes: string[] }) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lot.name);
  const [capacity, setCapacity] = useState(String(lot.capacity));
  const [color, setColor] = useState(lot.color ?? "");
  const [purposes, setPurposes] = useState<string[]>(lot.purposes);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      {!editing && (
        <div className="mt-2 flex items-center gap-3">
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setName(lot.name);
                setCapacity(String(lot.capacity));
                setColor(lot.color ?? "");
                setPurposes(lot.purposes);
                setEditing(true);
              }}
              className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
            >
              Edit
            </button>
          )}
          {lot.assigned > 0 && (
            <a
              href={`/admin/parking/print?lot_id=${lot.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-purple-600 hover:underline dark:text-purple-400"
            >
              Print Passes ({lot.assigned})
            </a>
          )}
        </div>
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || deleting || !name.trim()}
              className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving || deleting}
              className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
            >
              Cancel
            </button>
            {canDelete && (
              <button
                type="button"
                disabled={saving || deleting}
                onClick={async () => {
                  if (!window.confirm(`Delete "${lot.name}"? This cannot be undone.`)) return;
                  setDeleting(true);
                  try {
                    await onDelete(lot.id);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="ml-auto rounded border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
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
  anchorRect,
}: {
  lots: Lot[];
  onAssign: (lotId: string, notes: string) => Promise<void>;
  onClose: () => void;
  anchorRect: DOMRect;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Render via portal so the table's overflow-x-auto never clips the menu.
  const menuHeight = 300;
  const openUp = anchorRect.bottom + menuHeight + 16 > window.innerHeight;
  const style: React.CSSProperties = {
    position: "fixed",
    right: window.innerWidth - anchorRect.right,
    width: "15rem",
    zIndex: 50,
    ...(openUp
      ? { bottom: window.innerHeight - anchorRect.top + 4 }
      : { top: anchorRect.bottom + 4 }),
  };

  return createPortal(
    <div style={style} className="rounded-md border bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
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
    </div>,
    document.body,
  );
}

// ─── Proximity audit types ─────────────────────────────────────────────────────

type ProximityAuditIssue = {
  family_id: string;
  hof_its: string;
  head_name: string;
  anchor_color: string;
  anchor_lot_name: string;
  passes_to_revoke: { id: string; lot_name: string; lot_color: string | null }[];
  overflow_lot: { id: string; name: string; color: string | null } | null;
  using_fallback: boolean;
  over_capacity: boolean;
};

type ProximityAuditResult = {
  issues: ProximityAuditIssue[];
  total_families: number;
  total_to_revoke: number;
};

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ParkingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const [lots, setLots] = useState<Lot[]>([]);
  const [rows, setRows] = useState<HouseholdRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState(""); // client-side head-name filter, no refetch
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // bulk-assign result message
  const [assignFor, setAssignFor] = useState<{ familyId: string; rect: DOMRect; extra?: boolean } | null>(null);
  const [assignCount, setAssignCount] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  // Bulk "fill lot" flow: selection spans pages and survives search narrowing; it clears
  // on server-filter changes (the set it was built against changed) and after an assign.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lotFilter, setLotFilter] = useState(""); // client-side: show only rows with a pass in this lot
  const [multiPassFilter, setMultiPassFilter] = useState(false); // client-side: suggested_passes > 1
  const [exhaustedFilter, setExhaustedFilter] = useState(false); // client-side: passes >= suggested_passes > 0
  const [notFilledFilter, setNotFilledFilter] = useState(false); // client-side: suggested_passes > 0 && passes < suggested_passes
  const [overAllocatedFilter, setOverAllocatedFilter] = useState(false); // client-side: passes.length > suggested_passes
  const [bulkLotId, setBulkLotId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectN, setSelectN] = useState(""); // "select N rows" input
  const [unassignBusy, setUnassignBusy] = useState(false);
  // Auto-narrow the list to households fitting the target lot's purposes. Turned on
  // when a narrowable lot is picked; the chip stays toggleable for deliberate overrides.
  const [purposeFit, setPurposeFit] = useState(false);

  const [itsLookup, setItsLookup] = useState("");
  const [itsResult, setItsResult] = useState<{ head_name: string; passes: { lot_name: string; lot_color: string | null; printed_at: string | null }[] } | null | "not_found">(null);
  const [itsLooking, setItsLooking] = useState(false);

  const [proximityOpen, setProximityOpen] = useState(false);
  const [proximityAudit, setProximityAudit] = useState<ProximityAuditResult | null>(null);
  const [proximityLoading, setProximityLoading] = useState(false);
  const [proximityFixing, setProximityFixing] = useState(false);
  const [proximityNotice, setProximityNotice] = useState<string | null>(null);

  // Gate: signed-in portal user with parking view access (see canViewParking).
  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    if (!canViewParking(user)) {
      router.push("/admin/conversations");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanManage(canManageParking(user));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanDelete(isAdminOrLeadership(user));
    setReady(true);
  }, [router]);

  const loadLots = useCallback(async () => {
    const res = await apiFetch("/api/admin/parking/lots");
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Failed to load lots");
    setLots(json.lots ?? []);
  }, []);

  const loadHouseholds = useCallback(
    async (f: Filters) => {
      const params = new URLSearchParams();
      const tri = (key: string, val: boolean | null) => {
        if (val === true) params.set(key, "1");
        else if (val === false) params.set(key, "0");
      };
      tri("eligible", f.eligible);
      if (f.local_mehman) params.set("local_mehman", f.local_mehman);
      if (f.filterMode === "or") params.set("filter_mode", "or");
      tri("any_rahat", f.any_rahat);
      tri("any_senior", f.any_senior);
      tri("all_rahat", f.all_rahat);
      tri("all_65", f.all_65);
      tri("wheelchair", f.wheelchair);
      tri("has_phone", f.has_phone);
      tri("has_category", f.has_category);
      tri("kids_under_7", f.kids_under_7);
      tri("unprinted_passes", f.unprinted_passes);
      if (f.assigned) params.set("assigned", f.assigned);
      const res = await apiFetch(`/api/admin/parking/households?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load households");
      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
    },
    [],
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
    if (ready) void loadAll(DEFAULT_FILTERS);
    // Initial load once gated; subsequent loads go through applyFilter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function applyFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    setPage(1);
    setSelected(new Set()); // selection was built against the previous filtered set
    setNotice(null);
    void loadAll(next);
  }

  function toggleSelectAll() {
    const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.family_id));
    setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.family_id)));
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

  async function assignPass(familyId: string, lotId: string, notes: string, count = 1) {
    const res = await apiFetch("/api/admin/parking/passes", {
      method: "POST",
      body: JSON.stringify({ family_id: familyId, lot_id: lotId, notes, count }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Failed to assign pass");
      return;
    }
    await loadAll(filters);
  }

  async function revokePass(passId: string) {
    const res = await apiFetch(`/api/admin/parking/passes?id=${encodeURIComponent(passId)}`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Failed to revoke pass");
      return;
    }
    await loadAll(filters);
  }

  async function deleteLot(id: string) {
    const res = await apiFetch(`/api/admin/parking/lots?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Failed to delete lot");
      return;
    }
    setError(null);
    await loadAll(filters);
  }

  async function saveLot(patch: { id: string; name: string; capacity: number; color: string; purposes: string[] }) {
    const res = await apiFetch("/api/admin/parking/lots", {
      method: "PATCH",
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
  // Plain derivation — the React Compiler memoizes it. A manual useMemo here couldn't be
  // preserved by the compiler (the conditional filter-reassignment chain), which failed the build.
  let visible = rows;
  if (purposeFit && bulkLot && bulkLot.purposes.length > 0) {
    visible = visible.filter((r) => matchesLotPurposes(r, bulkLot.purposes));
  }
  if (lotFilter) {
    visible = visible.filter((r) => r.passes.some((p) => p.lot_id === lotFilter));
  }
  if (multiPassFilter) {
    visible = visible.filter((r) => r.suggested_passes > 1);
  }
  if (exhaustedFilter) {
    visible = visible.filter((r) => r.suggested_passes > 0 && r.passes.length >= r.suggested_passes);
  }
  if (notFilledFilter) {
    visible = visible.filter((r) => r.suggested_passes > 0 && r.passes.length < r.suggested_passes);
  }
  if (overAllocatedFilter) {
    visible = visible.filter((r) => r.passes.length > r.suggested_passes);
  }
  if (search) {
    const q = search.toLowerCase();
    visible = visible.filter((r) => r.head_name.toLowerCase().includes(q) || r.hof_its.includes(q));
  }

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

  // Bulk flow derived state. effectiveNew = total passes that would be inserted:
  // sum of (suggested_passes - existing_in_lot) per selected family, clamped ≥ 0.
  const rowByFamily = useMemo(() => new Map(rows.map((r) => [r.family_id, r])), [rows]);
  const effectiveNew = useMemo(() => {
    if (!bulkLot) return 0;
    let n = 0;
    for (const id of selected) {
      const row = rowByFamily.get(id);
      if (row) {
        const have = row.passes.filter((p) => p.lot_id === bulkLot.id).length;
        n += Math.max(0, row.suggested_passes - have);
      }
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

  // Selected households whose existing anchor pass conflicts with the target lot —
  // surfaced as a proximity warning in the bulk bar, never a block.
  const proximityViolations = useMemo(() => {
    if (!bulkLot || selected.size === 0) return 0;
    let n = 0;
    for (const id of selected) {
      const row = rowByFamily.get(id);
      if (row && row.passes.length > 0) {
        if (proximityConflict(row.passes.map((p) => p.lot_color), bulkLot.color)) n++;
      }
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
      const res = await apiFetch("/api/admin/parking/passes/bulk", {
        method: "POST",
        body: JSON.stringify({
          lot_id: bulkLot.id,
          family_ids: [...selected],
          quotas: Object.fromEntries([...selected].map((id) => [id, rowByFamily.get(id)?.suggested_passes ?? 1])),
        }),
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

  async function bulkUnassign() {
    if (selected.size === 0) return;
    if (!window.confirm(`Remove ALL passes from ${selected.size} household${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setUnassignBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/admin/parking/passes/bulk", {
        method: "DELETE",
        body: JSON.stringify({ family_ids: [...selected] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Bulk unassign failed");
        return;
      }
      setNotice(`Removed ${json.deleted} pass${json.deleted === 1 ? "" : "es"} from ${selected.size} household${selected.size === 1 ? "" : "s"}.`);
      setSelected(new Set());
      await loadAll(filters);
    } finally {
      setUnassignBusy(false);
    }
  }

  async function lookupIts(its: string) {
    const q = its.trim();
    if (!q) return;
    setItsLooking(true);
    setItsResult(null);
    try {
      const res = await apiFetch(`/api/admin/parking/households?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      const match = (json.rows ?? []).find((r: { hof_its: string }) => r.hof_its === q);
      if (!match) {
        setItsResult("not_found");
      } else {
        setItsResult({ head_name: match.head_name, passes: match.passes });
      }
    } finally {
      setItsLooking(false);
    }
  }

  async function markPassPrinted(passId: string) {
    setError(null);
    const res = await apiFetch("/api/admin/parking/print/mark-printed", {
      method: "POST",
      body: JSON.stringify({ pass_ids: [passId] }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Mark as printed failed");
      return;
    }
    await loadAll(filters);
  }

  const loadProximityAudit = useCallback(async () => {
    setProximityLoading(true);
    setProximityNotice(null);
    try {
      const res = await apiFetch("/api/admin/parking/proximity");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProximityNotice((json as { error?: string }).error ?? "Failed to load audit");
        setProximityOpen(true);
        return;
      }
      setProximityAudit(json as ProximityAuditResult);
      setProximityOpen(true);
    } finally {
      setProximityLoading(false);
    }
  }, []);

  async function fixProximity() {
    if (!proximityAudit || proximityAudit.total_families === 0) return;
    if (
      !window.confirm(
        `Move ${proximityAudit.total_to_revoke} misallocated pass${proximityAudit.total_to_revoke === 1 ? "" : "es"} across ${proximityAudit.total_families} famil${proximityAudit.total_families === 1 ? "y" : "ies"} to their correct overflow lots?`,
      )
    ) return;
    setProximityFixing(true);
    try {
      const res = await apiFetch("/api/admin/parking/proximity", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean; revoked?: number; assigned?: number; skipped?: number; fallbacks_used?: number; error?: string;
      };
      if (!res.ok) {
        setProximityNotice(json.error ?? "Fix failed");
        return;
      }
      const parts = [
        `${json.revoked ?? 0} revoked`,
        `${json.assigned ?? 0} reassigned`,
        ...(json.skipped ? [`${json.skipped} skipped`] : []),
        ...(json.fallbacks_used ? [`${json.fallbacks_used} used fallback lot`] : []),
      ];
      setProximityNotice(`Done — ${parts.join(", ")}.`);
      setProximityAudit(null);
      await loadAll(filters);
    } finally {
      setProximityFixing(false);
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
  const suggestedCount = visible.reduce((n, r) => n + r.suggested_passes, 0);

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
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={() => {
                if (proximityOpen) { setProximityOpen(false); return; }
                void loadProximityAudit();
              }}
              disabled={proximityLoading}
              className="rounded-md border border-orange-300 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-900/20"
            >
              {proximityLoading ? "Loading…" : proximityOpen ? "Hide Proximity" : "Proximity Audit"}
            </button>
          )}
          <a
            href="/admin/parking/print"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-900/20"
          >
            Print All (by ITS)
          </a>
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
      </div>

      {/* ITS lookup */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/50">
        <span className="font-semibold text-gray-700 dark:text-gray-200">ITS lookup</span>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => { e.preventDefault(); void lookupIts(itsLookup); }}
        >
          <input
            type="text"
            value={itsLookup}
            onChange={(e) => { setItsLookup(e.target.value); setItsResult(null); }}
            placeholder="Enter HOF ITS…"
            className="w-36 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
          />
          <button
            type="submit"
            disabled={itsLooking || !itsLookup.trim()}
            className="rounded-md border border-gray-300 px-2.5 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {itsLooking ? "Looking…" : "Look up"}
          </button>
        </form>
        {itsResult === "not_found" && (
          <span className="text-gray-400">No household found for that ITS.</span>
        )}
        {itsResult && itsResult !== "not_found" && (
          <span className="text-gray-700 dark:text-gray-200">
            <span className="font-medium">{itsResult.head_name}</span>
            {itsResult.passes.length === 0 ? (
              <span className="ml-2 text-gray-400">— no passes assigned</span>
            ) : (
              itsResult.passes.map((p, i) => (
                <span key={i} className={`ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${p.printed_at ? "border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300" : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-600 dark:text-amber-300"}`}>
                  <ColorDot color={p.lot_color} />
                  {p.lot_name}
                  {p.printed_at ? <span className="text-green-600 dark:text-green-400" title={`Printed ${new Date(p.printed_at).toLocaleString()}`}>✓</span> : <span className="text-amber-500">● not printed</span>}
                </span>
              ))
            )}
          </span>
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

      {/* Proximity audit panel */}
      {canManage && proximityOpen && (
        <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/10">
          <div className="flex items-center justify-between border-b border-orange-200 px-3 py-2.5 dark:border-orange-800">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-orange-800 dark:text-orange-300">Proximity Audit</span>
              {proximityAudit && !proximityLoading && (
                <span className="text-xs text-orange-600 dark:text-orange-400">
                  {proximityAudit.total_families === 0
                    ? "No issues found"
                    : `${proximityAudit.total_families} famil${proximityAudit.total_families === 1 ? "y" : "ies"} · ${proximityAudit.total_to_revoke} pass${proximityAudit.total_to_revoke === 1 ? "" : "es"} to move`}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setProximityOpen(false)}
              className="text-xs text-orange-400 hover:text-orange-600 dark:hover:text-orange-200"
            >
              Close ×
            </button>
          </div>

          {proximityLoading && (
            <div className="px-3 py-5 text-center text-xs text-orange-500">Loading audit…</div>
          )}

          {!proximityLoading && proximityNotice && (
            <div className="px-3 py-2.5 text-xs text-orange-700 dark:text-orange-300">{proximityNotice}</div>
          )}

          {!proximityLoading && proximityAudit && (
            <>
              {proximityAudit.total_families === 0 ? (
                <div className="px-3 py-5 text-center text-xs text-orange-500">
                  All passes are correctly allocated.
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-orange-100 text-left text-[10px] uppercase tracking-wide text-orange-500 dark:border-orange-800 dark:text-orange-400">
                          <th className="px-3 py-2">Household</th>
                          <th className="px-3 py-2">Anchor lot</th>
                          <th className="px-3 py-2">Passes to move</th>
                          <th className="px-3 py-2">Target lot</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-orange-100 dark:divide-orange-900">
                        {proximityAudit.issues.map((issue) => (
                          <tr key={issue.family_id}>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                              <div className="font-medium">{issue.head_name}</div>
                              <div className="text-[10px] text-gray-400">{issue.hof_its}</div>
                            </td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                              <div className="flex items-center gap-1.5">
                                <ColorDot color={issue.anchor_color} />
                                {issue.anchor_lot_name}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {issue.passes_to_revoke.map((p) => (
                                  <span
                                    key={p.id}
                                    className="inline-flex items-center gap-1 rounded border border-gray-200 px-1.5 py-0.5 text-gray-600 dark:border-gray-600 dark:text-gray-300"
                                  >
                                    <ColorDot color={p.lot_color} />
                                    {p.lot_name}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {issue.overflow_lot ? (
                                <div className={`flex items-center gap-1.5 ${issue.using_fallback ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                                  <ColorDot color={issue.overflow_lot.color} />
                                  {issue.overflow_lot.name}
                                  {issue.using_fallback && <span className="text-[10px]">(fallback)</span>}
                                  {issue.over_capacity && <span title="Over capacity — will soft-exceed">⚠</span>}
                                </div>
                              ) : (
                                <span className="text-red-500">No lot available</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between border-t border-orange-200 px-3 py-2.5 dark:border-orange-800">
                    <span className="text-xs text-orange-600 dark:text-orange-400">
                      {proximityAudit.total_to_revoke} pass{proximityAudit.total_to_revoke === 1 ? "" : "es"} will be moved
                    </span>
                    <button
                      type="button"
                      onClick={() => void fixProximity()}
                      disabled={proximityFixing}
                      className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                    >
                      {proximityFixing ? "Fixing…" : `Fix All (${proximityAudit.total_to_revoke} move${proximityAudit.total_to_revoke === 1 ? "" : "s"})`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Lot dashboard */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {lots.map((lot) => (
          <LotCard key={lot.id} lot={lot} canManage={canManage} canDelete={canDelete} onSave={saveLot} onDelete={deleteLot} />
        ))}
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {/* AND / OR toggle — only shown when at least one criteria chip is active */}
        {([filters.any_rahat, filters.any_senior, filters.all_rahat, filters.all_65,
           filters.wheelchair, filters.has_phone, filters.has_category, filters.kids_under_7, filters.unprinted_passes]
           .filter((v) => v !== null).length > 1) && (
          <div className="flex overflow-hidden rounded-full border border-gray-300 dark:border-gray-600">
            {(["and", "or"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => applyFilter({ filterMode: mode })}
                className={`px-2.5 py-1 uppercase ${
                  filters.filterMode === mode
                    ? "bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900"
                    : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
        <FilterChip
          active={filters.eligible === true}
          label="Eligible (local or mehman w/ rental)"
          onClick={() => applyFilter({ eligible: filters.eligible === true ? null : true })}
        />
        <FilterChip
          active={filters.eligible === false}
          label="Not eligible"
          negative
          onClick={() => applyFilter({ eligible: filters.eligible === false ? null : false })}
        />
        <FilterChip
          active={multiPassFilter}
          label="2+ passes"
          onClick={() => { setMultiPassFilter(!multiPassFilter); setPage(1); }}
        />
        <FilterChip
          active={exhaustedFilter}
          label="All passes filled"
          onClick={() => { setExhaustedFilter(!exhaustedFilter); setPage(1); }}
        />
        <FilterChip
          active={notFilledFilter}
          label="Passes not filled"
          onClick={() => { setNotFilledFilter(!notFilledFilter); setPage(1); }}
        />
        <FilterChip
          active={overAllocatedFilter}
          label="Over-allocated"
          negative
          onClick={() => { setOverAllocatedFilter(!overAllocatedFilter); setPage(1); }}
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
          active={filters.any_rahat === true}
          label="Any rahat"
          onClick={() => applyFilter({ any_rahat: filters.any_rahat === true ? null : true })}
        />
        <FilterChip
          active={filters.any_rahat === false}
          label="No rahat"
          negative
          onClick={() => applyFilter({ any_rahat: filters.any_rahat === false ? null : false })}
        />
        <FilterChip
          active={filters.any_senior === true}
          label="Any 65+"
          onClick={() => applyFilter({ any_senior: filters.any_senior === true ? null : true })}
        />
        <FilterChip
          active={filters.any_senior === false}
          label="No 65+"
          negative
          onClick={() => applyFilter({ any_senior: filters.any_senior === false ? null : false })}
        />
        <FilterChip
          active={filters.all_rahat === true}
          label="All rahat"
          onClick={() => applyFilter({ all_rahat: filters.all_rahat === true ? null : true })}
        />
        <FilterChip
          active={filters.all_rahat === false}
          label="Not all rahat"
          negative
          onClick={() => applyFilter({ all_rahat: filters.all_rahat === false ? null : false })}
        />
        <FilterChip
          active={filters.all_65 === true}
          label="All 65+"
          onClick={() => applyFilter({ all_65: filters.all_65 === true ? null : true })}
        />
        <FilterChip
          active={filters.all_65 === false}
          label="Not all 65+"
          negative
          onClick={() => applyFilter({ all_65: filters.all_65 === false ? null : false })}
        />
        <FilterChip
          active={filters.wheelchair === true}
          label="Needs wheelchair"
          onClick={() => applyFilter({ wheelchair: filters.wheelchair === true ? null : true })}
        />
        <FilterChip
          active={filters.wheelchair === false}
          label="No wheelchair"
          negative
          onClick={() => applyFilter({ wheelchair: filters.wheelchair === false ? null : false })}
        />
        <FilterChip
          active={filters.kids_under_7 === true}
          label="Kids under 7"
          onClick={() => applyFilter({ kids_under_7: filters.kids_under_7 === true ? null : true })}
        />
        <FilterChip
          active={filters.kids_under_7 === false}
          label="No kids under 7"
          negative
          onClick={() => applyFilter({ kids_under_7: filters.kids_under_7 === false ? null : false })}
        />
        <FilterChip
          active={filters.has_phone === true}
          label="Has phone"
          onClick={() => applyFilter({ has_phone: filters.has_phone === true ? null : true })}
        />
        <FilterChip
          active={filters.has_phone === false}
          label="No phone"
          negative
          onClick={() => applyFilter({ has_phone: filters.has_phone === false ? null : false })}
        />
        <FilterChip
          active={filters.has_category === true}
          label="VIP"
          onClick={() => applyFilter({ has_category: filters.has_category === true ? null : true })}
        />
        <FilterChip
          active={filters.has_category === false}
          label="Not VIP"
          negative
          onClick={() => applyFilter({ has_category: filters.has_category === false ? null : false })}
        />
        <FilterChip
          active={filters.unprinted_passes === true}
          label="Not printed"
          onClick={() => applyFilter({ unprinted_passes: filters.unprinted_passes === true ? null : true })}
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
        <select
          value={lotFilter}
          onChange={(e) => { setLotFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">All lots</option>
          {lots.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search name or ITS…"
          className="min-w-44 rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        />
        <span className="ml-auto text-gray-400">
          {loading ? "Loading…" : `${visible.length} of ${total} households`}
        </span>
      </div>

      {/* Bulk action bar */}
      {canManage && (
        <div className="mb-3 space-y-2">
          {/* Selection controls */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/50">
            <span className="font-semibold text-gray-700 dark:text-gray-200">Select</span>
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Math.max(1, Math.min(visible.length, parseInt(selectN) || 0));
                if (n > 0) setSelected(new Set(visible.slice(0, n).map((r) => r.family_id)));
              }}
            >
              <input
                type="number"
                min={1}
                max={visible.length}
                value={selectN}
                onChange={(e) => setSelectN(e.target.value)}
                placeholder="N rows"
                className="w-20 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              />
              <button
                type="submit"
                className="rounded-md border border-gray-300 px-2.5 py-1 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Select
              </button>
            </form>
            {selected.size > 0 && (
              <>
                <span className="text-gray-500 dark:text-gray-400">{selected.size} selected</span>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-gray-400 hover:underline"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => void bulkUnassign()}
                  disabled={unassignBusy}
                  className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {unassignBusy ? "Unassigning…" : `Unassign all passes (${selected.size})`}
                </button>
              </>
            )}
          </div>

          {/* Assign to lot */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/50">
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
                {proximityViolations > 0 && (
                  <span className="font-medium text-orange-600 dark:text-orange-400">
                    {`⚠ ${proximityViolations} of ${selected.size} selected ${
                      proximityViolations === 1 ? "has" : "have"
                    } an anchor pass that conflicts with this lot's proximity rules`}
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
        </div>
      )}

      {/* Household table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {canManage && (
                <th className="w-8 px-3 py-2" aria-label="Select all">
                  <input
                    type="checkbox"
                    checked={visible.length > 0 && visible.every((r) => selected.has(r.family_id))}
                    ref={(el) => {
                      if (el) el.indeterminate =
                        visible.some((r) => selected.has(r.family_id)) &&
                        !visible.every((r) => selected.has(r.family_id));
                    }}
                    onChange={toggleSelectAll}
                  />
                </th>
              )}
              <th className="px-3 py-2">Household</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Criteria</th>
              <th className="px-3 py-2">Guests</th>
              <th className="px-3 py-2">Passes</th>
              {canManage && <th className="px-3 py-2">Additional</th>}
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
                <td className="px-3 py-2 text-xs">
                  {r.utaro_guest_commute_count > 0 ? (
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{r.utaro_guest_commute_count}</span>
                      <span className="text-gray-400"> commute</span>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.suggested_passes > 0 && (
                    <div className={`mb-1 text-xs font-semibold tabular-nums ${
                      r.passes.length >= r.suggested_passes
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-500 dark:text-gray-400"
                    }`}>
                      {r.passes.length}/{r.suggested_passes}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {r.passes.length === 0 && r.suggested_passes === 0 && <span className="text-xs text-gray-400">—</span>}
                    {r.passes.map((p) => (
                      <span
                        key={p.id}
                        title={p.printed_at ? `Printed ${new Date(p.printed_at).toLocaleDateString()}` : (p.notes ?? "Not yet printed")}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${p.printed_at ? "border-gray-200 text-gray-700 dark:border-gray-600 dark:text-gray-300" : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-300"}`}
                      >
                        <ColorDot color={p.lot_color} />
                        {p.lot_name}
                        {canManage && !p.printed_at && (
                          <button
                            type="button"
                            onClick={() => void markPassPrinted(p.id)}
                            className="text-amber-500 hover:text-green-600"
                            aria-label={`Mark ${p.lot_name} pass as printed`}
                            title="Mark as printed"
                          >
                            ✓
                          </button>
                        )}
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
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setAssignFor(assignFor?.familyId === r.family_id && assignFor.extra ? null : { familyId: r.family_id, rect, extra: true });
                      }}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                    >
                      + Pass
                    </button>
                  </td>
                )}
                {canManage && (
                  <td className="px-3 py-2 text-right">
                    {r.suggested_passes > 0 && r.passes.length >= r.suggested_passes ? null : (
                      <div className="flex items-center justify-end gap-1.5">
                        {r.suggested_passes > 0 && (() => {
                          const remaining = Math.max(0, r.suggested_passes - r.passes.length);
                          const count = Math.min(remaining, assignCount[r.family_id] ?? remaining);
                          return remaining > 0 ? (
                            <input
                              type="number"
                              min={1}
                              max={remaining}
                              value={count}
                              onChange={(e) => {
                                const v = Math.max(1, Math.min(remaining, parseInt(e.target.value) || 1));
                                setAssignCount((prev) => ({ ...prev, [r.family_id]: v }));
                              }}
                              className="w-12 rounded border border-gray-300 px-1 py-1 text-center text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                            />
                          ) : null;
                        })()}
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setAssignFor(assignFor?.familyId === r.family_id && !assignFor.extra ? null : { familyId: r.family_id, rect });
                          }}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          Assign
                        </button>
                      </div>
                    )}
                    {assignFor?.familyId === r.family_id && (
                      <AssignMenu
                        lots={lots}
                        anchorRect={assignFor.rect}
                        onAssign={(lotId, notes) => {
                          if (assignFor.extra) return assignPass(r.family_id, lotId, notes, 1);
                          const remaining = Math.max(0, r.suggested_passes - r.passes.length);
                          const count = r.suggested_passes > 0
                            ? Math.min(remaining, assignCount[r.family_id] ?? remaining)
                            : 1;
                          return assignPass(r.family_id, lotId, notes, Math.max(1, count));
                        }}
                        onClose={() => setAssignFor(null)}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={canManage ? 9 : 6} className="px-3 py-8 text-center text-sm text-gray-400">
                  No households match the current filters.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 text-xs font-medium dark:border-gray-700 dark:bg-gray-800">
            <tr>
              {canManage && <td />}
              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                {visible.length} household{visible.length !== 1 ? "s" : ""}
              </td>
              <td colSpan={4} />
              <td className="px-3 py-2">
                <span className="text-gray-500 dark:text-gray-400">
                  {passCount} assigned
                </span>
                {suggestedCount > 0 && (
                  <span className="ml-2 text-gray-400 dark:text-gray-500">
                    / {suggestedCount} suggested
                  </span>
                )}
              </td>
              {canManage && <td colSpan={2} />}
            </tr>
          </tfoot>
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
