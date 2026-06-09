"use client";

import type { Ticket } from "./types";

type Props = {
  ticket: Ticket;
  index: number;
  onClick: () => void;
  onQuickClaim?: () => void;
  showClaimButton?: boolean;
};

/** Returns ms remaining until deadline. Negative = overdue. */
function msRemaining(deadline: string | null): number | null {
  if (!deadline) return null;
  return new Date(deadline).getTime() - Date.now();
}

/** SLA bar fill percentage (0–100). Clamped for display. */
function slaFillPercent(ticket: Ticket): number {
  if (!ticket.escalated_at || !ticket.escalation_sla_deadline) return 100;
  const total =
    new Date(ticket.escalation_sla_deadline).getTime() -
    new Date(ticket.escalated_at).getTime();
  if (total <= 0) return 0;
  const remaining = msRemaining(ticket.escalation_sla_deadline) ?? 0;
  const pct = (remaining / total) * 100;
  return Math.max(0, Math.min(100, pct));
}

function slaBarModifier(pct: number): string {
  if (pct > 50) return "triage-sla-bar-ok";
  if (pct > 10) return "triage-sla-bar-warn";
  return "triage-sla-bar-breach";
}

function slaColor(pct: number): string {
  if (pct > 50) return "var(--triage-sla-ok)";
  if (pct > 10) return "var(--triage-sla-warn)";
  return "var(--triage-sla-breach)";
}

function formatSlaLabel(ms: number | null): string {
  if (ms === null) return "";
  if (ms <= 0) return "OVERDUE";
  const totalMins = Math.floor(ms / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

export function TicketCard({
  ticket,
  index,
  onClick,
  onQuickClaim,
  showClaimButton = false,
}: Props) {
  const remaining = msRemaining(ticket.escalation_sla_deadline);
  const pct = slaFillPercent(ticket);
  const isOverdue = remaining !== null && remaining <= 0;
  const slaLabel = formatSlaLabel(remaining);
  const hasSla = ticket.escalation_sla_deadline !== null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className={`triage-card triage-card-enter${isOverdue ? " triage-sla-breaching" : ""}`}
      style={{
        animationDelay: `${index * 50}ms`,
        background: "var(--triage-surface)",
        border: "1px solid var(--triage-border)",
        borderRadius: "12px",
        padding: "12px",
        cursor: "pointer",
        position: "relative",
        outline: "none",
      }}
    >
      {/* Top row: name + priority badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "6px",
          marginBottom: "4px",
        }}
      >
        <span
          className="triage-heading"
          style={{ fontSize: "13px", color: "var(--triage-text)", flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {ticket.display_name}
        </span>

        <span
          className={`triage-badge-${ticket.escalation_priority === "urgent" ? "urgent" : "normal"} rounded-full`}
          style={{
            padding: "2px 8px",
            fontSize: "10px",
            fontWeight: 600,
            borderRadius: "9999px",
            textTransform: "uppercase",
            flexShrink: 0,
            letterSpacing: "0.04em",
          }}
        >
          {ticket.escalation_priority}
        </span>
      </div>

      {/* Category badge */}
      {ticket.escalation_category && (
        <span
          style={{
            display: "inline-block",
            background: "var(--triage-claimed-bg)",
            color: "var(--triage-claimed)",
            borderRadius: "9999px",
            padding: "2px 8px",
            fontSize: "11px",
            fontWeight: 500,
            marginBottom: "6px",
          }}
        >
          {ticket.escalation_category}
        </span>
      )}

      {/* Message preview */}
      {ticket.last_inbound_message && (
        <p
          style={{
            color: "var(--triage-text-secondary)",
            fontSize: "11px",
            fontStyle: "italic",
            margin: "0 0 6px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {ticket.last_inbound_message}
        </p>
      )}

      {/* Footer row: timestamp + message count + SLA */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "4px",
        }}
      >
        <span
          style={{
            color: "var(--triage-text-muted)",
            fontSize: "10px",
          }}
        >
          {formatTimestamp(ticket.escalated_at)}
          {ticket.message_count > 0 && (
            <> · {ticket.message_count} msg</>
          )}
        </span>

        {hasSla && (
          <span
            style={{
              color: slaColor(pct),
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: isOverdue ? "0.05em" : undefined,
              fontFamily: "'IBM Plex Mono', monospace",
              flexShrink: 0,
            }}
          >
            {slaLabel}
          </span>
        )}
      </div>

      {/* SLA bar */}
      {hasSla && (
        <div className="triage-sla-bar">
          <div
            className={`triage-sla-bar-fill ${slaBarModifier(pct)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Assignee (picked_up / waiting) */}
      {ticket.assignee_name && (
        <div
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <div
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              background: "var(--triage-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "9px",
              color: "#fff",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {ticket.assignee_name[0]?.toUpperCase() ?? "?"}
          </div>
          <span
            style={{
              color: "var(--triage-text-muted)",
              fontSize: "11px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {ticket.assignee_name}
          </span>
        </div>
      )}

      {/* Quick-claim button (pending cards, on hover via CSS group) */}
      {showClaimButton && onQuickClaim && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onQuickClaim();
          }}
          className="triage-quick-claim-btn"
          style={{
            marginTop: "8px",
            width: "100%",
            background: "var(--triage-accent)",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            padding: "5px 0",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--triage-accent-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--triage-accent)";
          }}
        >
          Claim
        </button>
      )}
    </div>
  );
}
