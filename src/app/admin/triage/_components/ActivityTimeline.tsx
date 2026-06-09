"use client";

import type { ActivityEntry } from "./types";

type Props = {
  activities: ActivityEntry[];
};

const ACTION_LABELS: Record<string, string> = {
  escalated: "Escalated",
  picked_up: "Claimed",
  created_task: "Created task",
  linked_to_task: "Linked to task",
  unlinked_from_task: "Unlinked from task",
  resolved: "Resolved",
  bulk_resolved: "Bulk resolved",
  reassigned: "Reassigned",
};

function dotColor(action: string): string {
  switch (action) {
    case "escalated":
      return "var(--triage-pending)";
    case "picked_up":
      return "var(--triage-claimed)";
    case "created_task":
    case "linked_to_task":
      return "var(--triage-waiting)";
    case "unlinked_from_task":
      return "var(--triage-text-muted)";
    case "resolved":
    case "bulk_resolved":
      return "var(--triage-resolved)";
    case "reassigned":
      return "var(--triage-sla-warn)";
    default:
      return "var(--triage-text-muted)";
  }
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

export function ActivityTimeline({ activities }: Props) {
  const sorted = [...activities].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div
      className="triage-panel-enter"
      style={{
        background: "var(--triage-surface)",
        border: "1px solid var(--triage-border)",
        borderRadius: "12px",
        padding: "12px",
      }}
    >
      <p
        className="triage-heading"
        style={{
          fontSize: "13px",
          color: "var(--triage-text)",
          marginBottom: "12px",
        }}
      >
        Activity
      </p>

      {sorted.length === 0 ? (
        <p
          style={{
            color: "var(--triage-text-muted)",
            fontSize: "12px",
          }}
        >
          No activity yet.
        </p>
      ) : (
        <div style={{ position: "relative" }}>
          {/* Vertical connector line */}
          {sorted.length > 1 && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "4px",
                top: "10px",
                bottom: "10px",
                width: "1px",
                background: "var(--triage-border)",
              }}
            />
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {sorted.map((entry) => {
              const note =
                entry.details &&
                typeof entry.details === "object" &&
                "resolution_note" in entry.details &&
                typeof entry.details.resolution_note === "string"
                  ? entry.details.resolution_note
                  : null;

              return (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "flex-start",
                    position: "relative",
                  }}
                >
                  {/* Dot */}
                  <div
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: dotColor(entry.action),
                      flexShrink: 0,
                      marginTop: "3px",
                      zIndex: 1,
                    }}
                  />

                  {/* Content */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 500,
                          color: "var(--triage-text)",
                        }}
                      >
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--triage-text-muted)",
                          flexShrink: 0,
                        }}
                      >
                        {timeAgo(entry.created_at)}
                      </span>
                    </div>

                    {entry.actor_label && (
                      <p
                        style={{
                          fontSize: "11px",
                          color: "var(--triage-text-secondary)",
                          margin: "1px 0 0",
                        }}
                      >
                        by {entry.actor_label}
                      </p>
                    )}

                    {note && (
                      <p
                        style={{
                          fontSize: "11px",
                          color: "var(--triage-text-secondary)",
                          fontStyle: "italic",
                          margin: "3px 0 0",
                          padding: "4px 8px",
                          background: "var(--triage-surface-raised)",
                          borderRadius: "6px",
                          borderLeft: "2px solid var(--triage-border)",
                        }}
                      >
                        {note}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
