"use client";

import "./triage.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import type { BoardData, Department, Filters, Ticket } from "./_components/types";
import { SLADashboardStrip } from "./_components/SLADashboardStrip";
import { FilterBar } from "./_components/FilterBar";
import { KanbanBoard } from "./_components/KanbanBoard";
import { TicketDetailView } from "./_components/TicketDetailView";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_STATS = {
  open_count: 0,
  pending_count: 0,
  breaching_count: 0,
  avg_pickup_minutes: null,
  resolved_today_count: 0,
};

// ── Filter persistence ────────────────────────────────────────────────────────

function loadFilters(currentUserId: string | undefined): Filters {
  if (typeof window === "undefined") {
    return { assignee: "all", priority: "all", category: "all", department: "all" };
  }
  try {
    const stored = JSON.parse(localStorage.getItem("triage_filters") ?? "null") as Filters | null;
    if (stored) return stored;
  } catch {
    // ignore parse errors
  }
  return {
    assignee: currentUserId ?? "all",
    priority: "all",
    category: "all",
    department: "all",
  };
}

function saveFilters(filters: Filters) {
  try {
    localStorage.setItem("triage_filters", JSON.stringify(filters));
  } catch {
    // ignore storage errors
  }
}

// ── View state ────────────────────────────────────────────────────────────────

type View = { kind: "board" } | { kind: "detail"; ticket: Ticket };

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TriagePage() {
  const currentUser = readAdminUser();

  const [boardData, setBoardData] = useState<BoardData>({
    tickets: [],
    team_members: [],
    sla_stats: DEFAULT_STATS,
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "board" });
  const [statHighlight, setStatHighlight] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() =>
    loadFilters(currentUser?.id),
  );

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchBoard = useCallback(async () => {
    const res = await apiFetch("/api/admin/triage/board");
    if (res.ok) {
      const data = (await res.json()) as BoardData;
      setBoardData(data);
    }
  }, []);

  const fetchBoardSilently = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/triage/board");
      if (res.ok) {
        const data = (await res.json()) as BoardData;
        setBoardData(data);
      }
    } catch {
      // silently ignore on background refresh
    }
  }, []);

  // Initial load: board + departments
  useEffect(() => {
    async function initialLoad() {
      await Promise.all([
        fetchBoard(),
        apiFetch("/api/admin/mumineen/departments").then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as
            | { departments: Department[] }
            | Department[];
          if (Array.isArray(data)) {
            setDepartments(data);
          } else if (data.departments) {
            setDepartments(data.departments);
          }
        }).catch(() => undefined),
      ]);
      setLoading(false);
    }
    void initialLoad();
  }, [fetchBoard]);

  // SSE subscription
  useEffect(() => {
    const source = new EventSource("/api/admin/triage/stream");
    source.addEventListener("open", () => {
      void fetchBoardSilently();
    });
    source.addEventListener("changed", () => {
      void fetchBoardSilently();
    });
    return () => {
      source.close();
    };
  }, [fetchBoardSilently]);

  // Visibility change refresh
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void fetchBoardSilently();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchBoardSilently]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const categories = useMemo(() => {
    const cats = new Set(boardData.tickets.map((t) => t.escalation_category));
    return [...cats].sort();
  }, [boardData.tickets]);

  // Compute stats from the FILTERED ticket set so they match the board.
  // avg_pickup_minutes and resolved_today_count come from the server (need DB).
  const filteredStats = useMemo(() => {
    const activeStages = new Set(["pending", "picked_up", "waiting_on_department"]);

    // Apply the same filter logic the KanbanBoard uses
    let filtered = boardData.tickets.filter((t) => activeStages.has(t.escalation_stage));

    if (filters.priority !== "all") {
      filtered = filtered.filter((t) => t.escalation_priority === filters.priority);
    }
    if (filters.category !== "all") {
      filtered = filtered.filter((t) => t.escalation_category === filters.category);
    }

    // Assignee filter only applies to picked_up / waiting columns
    const pendingTickets = filtered.filter((t) => t.escalation_stage === "pending");
    let assignedTickets = filtered.filter((t) => t.escalation_stage !== "pending");
    if (filters.assignee !== "all") {
      if (filters.assignee === "unassigned") {
        assignedTickets = assignedTickets.filter((t) => !t.escalation_assigned_to);
      } else {
        assignedTickets = assignedTickets.filter((t) => t.escalation_assigned_to === filters.assignee);
      }
    }

    const visibleTickets = [...pendingTickets, ...assignedTickets];
    const now = Date.now();

    return {
      open_count: visibleTickets.length,
      pending_count: pendingTickets.length,
      breaching_count: visibleTickets.filter(
        (t) => t.escalation_sla_deadline && new Date(t.escalation_sla_deadline).getTime() < now,
      ).length,
      avg_pickup_minutes: boardData.sla_stats.avg_pickup_minutes,
      resolved_today_count: boardData.sla_stats.resolved_today_count,
    };
  }, [boardData.tickets, boardData.sla_stats, filters]);

  // ── Event handlers ────────────────────────────────────────────────────────

  const handleFiltersChange = useCallback((next: Filters) => {
    setFilters(next);
    saveFilters(next);
    setStatHighlight(null);
  }, []);

  const handleStatClick = useCallback((filter: string) => {
    setStatHighlight((prev) => (prev === filter ? null : filter));
  }, []);

  const handleQuickClaim = useCallback(
    async (ticket: Ticket) => {
      try {
        await apiFetch(
          `/api/admin/escalations/${encodeURIComponent(ticket.phone_e164)}/claim`,
          { method: "POST" },
        );
        void fetchBoardSilently();
      } catch {
        // silently ignore
      }
    },
    [fetchBoardSilently],
  );

  // ── Rendering ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main
        className="triage-desk"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "calc(100vh - 4rem)",
        }}
      >
        <p
          className="triage-heading"
          style={{ color: "var(--triage-text-muted)" }}
        >
          Loading…
        </p>
      </main>
    );
  }

  if (view.kind === "detail") {
    const { ticket } = view;
    return (
      <main className="triage-desk h-[calc(100vh-4rem)] triage-detail-enter">
        <TicketDetailView
          ticket={ticket}
          departments={departments}
          onBack={() => setView({ kind: "board" })}
          onAction={() => void fetchBoardSilently()}
        />
      </main>
    );
  }

  return (
    <main className="triage-desk flex h-[calc(100vh-4rem)] flex-col">
      <SLADashboardStrip
        stats={filteredStats}
        onStatClick={handleStatClick}
      />
      <FilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        teamMembers={boardData.team_members}
        departments={departments}
        categories={categories}
      />
      <KanbanBoard
        tickets={boardData.tickets}
        filters={filters}
        onSelectTicket={(ticket) => setView({ kind: "detail", ticket })}
        onQuickClaim={handleQuickClaim}
        statHighlight={statHighlight}
      />
    </main>
  );
}
