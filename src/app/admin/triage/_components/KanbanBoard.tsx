"use client";

import { useState, useMemo } from "react";
import { TicketCard } from "./TicketCard";
import type { Ticket, Filters } from "./types";

type Props = {
  tickets: Ticket[];
  filters: Filters;
  onSelectTicket: (ticket: Ticket) => void;
  onQuickClaim: (ticket: Ticket) => void;
  statHighlight: string | null;
};

// ── helpers ──────────────────────────────────────────────────────────────────

function isSlaBreaching(ticket: Ticket): boolean {
  if (!ticket.escalation_sla_deadline) return false;
  return new Date(ticket.escalation_sla_deadline).getTime() <= Date.now();
}

function isResolvedToday(ticket: Ticket): boolean {
  if (!ticket.escalated_at) return false;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  // Use escalated_at as a proxy for "resolved recently" — boards would use
  // a resolved_at field if available; we fall back to escalated_at when null.
  return new Date(ticket.escalated_at).getTime() >= cutoff;
}

function filterTickets(
  tickets: Ticket[],
  stage: "pending" | "picked_up" | "waiting_on_department" | "resolved",
  filters: Filters,
  statHighlight: string | null,
): Ticket[] {
  let result = tickets.filter((t) => t.escalation_stage === stage);

  // Priority filter — applies to all
  if (filters.priority !== "all") {
    result = result.filter(
      (t) => t.escalation_priority === filters.priority,
    );
  }

  // Category filter — applies to all
  if (filters.category !== "all") {
    result = result.filter(
      (t) => t.escalation_category === filters.category,
    );
  }

  // Assignee filter — only for picked_up and waiting_on_department
  if (
    filters.assignee !== "all" &&
    (stage === "picked_up" || stage === "waiting_on_department")
  ) {
    if (filters.assignee === "unassigned") {
      result = result.filter((t) => !t.escalation_assigned_to);
    } else {
      result = result.filter(
        (t) => t.escalation_assigned_to === filters.assignee,
      );
    }
  }

  // Stat highlight: only show SLA-breaching
  if (statHighlight === "breaching") {
    result = result.filter(isSlaBreaching);
  }

  // Resolved: only last 24 h
  if (stage === "resolved") {
    result = result.filter(isResolvedToday);
    // Most recent first
    result.sort(
      (a, b) =>
        new Date(b.escalated_at ?? 0).getTime() -
        new Date(a.escalated_at ?? 0).getTime(),
    );
    return result;
  }

  // Pending: sort by SLA deadline asc (nulls last)
  if (stage === "pending") {
    result.sort((a, b) => {
      if (!a.escalation_sla_deadline) return 1;
      if (!b.escalation_sla_deadline) return -1;
      return (
        new Date(a.escalation_sla_deadline).getTime() -
        new Date(b.escalation_sla_deadline).getTime()
      );
    });
  }

  // Picked up: sort by escalated_at asc
  if (stage === "picked_up") {
    result.sort(
      (a, b) =>
        new Date(a.escalated_at ?? 0).getTime() -
        new Date(b.escalated_at ?? 0).getTime(),
    );
  }

  return result;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 12px",
        gap: "6px",
        color: "var(--triage-text-muted)",
        fontSize: "12px",
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M6.5 10.5l2.5 2.5 4.5-4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>No tickets</span>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

type ColumnConfig = {
  stage: "pending" | "picked_up" | "waiting_on_department" | "resolved";
  label: string;
  accent: string; // triage-col-* class
  color: string; // CSS variable for header text
};

const COLUMNS: ColumnConfig[] = [
  {
    stage: "pending",
    label: "Pending",
    accent: "triage-col-pending",
    color: "var(--triage-pending)",
  },
  {
    stage: "picked_up",
    label: "Picked Up",
    accent: "triage-col-claimed",
    color: "var(--triage-claimed)",
  },
  {
    stage: "waiting_on_department",
    label: "Waiting on Dept.",
    accent: "triage-col-waiting",
    color: "var(--triage-waiting)",
  },
];

const RESOLVED_COLUMN: ColumnConfig = {
  stage: "resolved",
  label: "Resolved",
  accent: "triage-col-resolved",
  color: "var(--triage-resolved)",
};

// ── KanbanBoard ───────────────────────────────────────────────────────────────

export function KanbanBoard({
  tickets,
  filters,
  onSelectTicket,
  onQuickClaim,
  statHighlight,
}: Props) {
  const [showResolved, setShowResolved] = useState(false);

  const unassignedOnly = filters.assignee === "unassigned";

  const visibleColumns = useMemo(() => {
    // When "unassigned" filter is active, only show pending column
    const base = unassignedOnly ? [COLUMNS[0]] : COLUMNS;
    return showResolved ? [...base, RESOLVED_COLUMN] : base;
  }, [showResolved, unassignedOnly]);

  const columnTickets = useMemo(() => {
    const map: Record<string, Ticket[]> = {};
    for (const col of [...COLUMNS, RESOLVED_COLUMN]) {
      map[col.stage] = filterTickets(tickets, col.stage, filters, statHighlight);
    }
    return map;
  }, [tickets, filters, statHighlight]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* "Show Resolved" toggle */}
      <div
        style={{
          padding: "8px 16px",
          display: "flex",
          justifyContent: "flex-end",
          borderBottom: "1px solid var(--triage-border)",
          background: "var(--triage-surface-raised)",
        }}
      >
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          style={{
            fontSize: "12px",
            fontWeight: 500,
            color: showResolved
              ? "var(--triage-resolved)"
              : "var(--triage-text-muted)",
            background: showResolved
              ? "var(--triage-resolved-bg)"
              : "transparent",
            border: "1px solid",
            borderColor: showResolved
              ? "var(--triage-resolved)"
              : "var(--triage-border)",
            borderRadius: "6px",
            padding: "3px 10px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {showResolved ? "Hide Resolved" : "Show Resolved"}
        </button>
      </div>

      {/* Board */}
      <div
        style={{
          display: "flex",
          flex: 1,
          gap: "12px",
          padding: "12px 16px",
          overflowX: "auto",
          overflowY: "hidden",
          minHeight: 0,
        }}
      >
        {visibleColumns.map((col) => {
          const colTickets = columnTickets[col.stage] ?? [];
          const isPending = col.stage === "pending";

          return (
            <div
              key={col.stage}
              className={col.accent}
              style={{
                display: "flex",
                flexDirection: "column",
                background: "var(--triage-surface-raised)",
                borderRadius: "10px",
                minWidth: "260px",
                maxWidth: "300px",
                flex: "1 1 0",
                overflow: "hidden",
              }}
            >
              {/* Column header */}
              <div
                style={{
                  padding: "10px 12px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid var(--triage-border-subtle)",
                  flexShrink: 0,
                }}
              >
                <span
                  className="triage-heading"
                  style={{ fontSize: "13px", color: col.color }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    background: "var(--triage-border)",
                    color: "var(--triage-text-secondary)",
                    borderRadius: "9999px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    fontWeight: 500,
                  }}
                >
                  {colTickets.length}
                </span>
              </div>

              {/* Ticket list */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {colTickets.length === 0 ? (
                  <EmptyState />
                ) : (
                  colTickets.map((ticket, idx) => (
                    <TicketCard
                      key={ticket.session_id}
                      ticket={ticket}
                      index={idx}
                      onClick={() => onSelectTicket(ticket)}
                      onQuickClaim={
                        isPending ? () => onQuickClaim(ticket) : undefined
                      }
                      showClaimButton={isPending}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
