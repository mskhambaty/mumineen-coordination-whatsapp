"use client";

import { useState } from "react";
import type { LinkedTask } from "./types";

type Props = {
  tasks: LinkedTask[];
  loading: boolean;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.2s ease",
        flexShrink: 0,
      }}
    >
      <path
        d="M3 5L7 9L11 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function statusBadgeStyle(status: string): React.CSSProperties {
  switch (status) {
    case "open":
      return {
        background: "var(--triage-claimed-bg)",
        color: "var(--triage-claimed)",
      };
    case "in_progress":
      return {
        background: "rgba(212, 148, 10, 0.12)",
        color: "var(--triage-sla-warn)",
      };
    case "blocked":
      return {
        background: "var(--triage-pending-bg)",
        color: "var(--triage-pending)",
      };
    case "complete":
      return {
        background: "var(--triage-resolved-bg)",
        color: "var(--triage-resolved)",
      };
    default:
      return {
        background: "var(--triage-surface-raised)",
        color: "var(--triage-text-muted)",
      };
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        ...statusBadgeStyle(status),
        padding: "2px 7px",
        borderRadius: "9999px",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "capitalize",
        letterSpacing: "0.02em",
        flexShrink: 0,
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function TaskCard({
  task,
  isLinked,
}: {
  task: LinkedTask;
  isLinked: boolean;
}) {
  return (
    <div
      style={{
        background: isLinked ? "var(--triage-claimed-bg)" : "var(--triage-surface-raised)",
        border: `1px solid ${isLinked ? "var(--triage-claimed)" : "var(--triage-border)"}`,
        borderRadius: "8px",
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <p
          style={{
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--triage-text)",
            margin: 0,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {task.title}
        </p>
        <StatusBadge status={task.status} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginTop: "4px",
          flexWrap: "wrap",
        }}
      >
        {task.department_name && (
          <span
            style={{
              fontSize: "10px",
              color: "var(--triage-text-muted)",
            }}
          >
            {task.department_name}
          </span>
        )}
        <span
          style={{
            fontSize: "10px",
            color: "var(--triage-text-muted)",
            textTransform: "capitalize",
          }}
        >
          · {task.priority}
        </span>
        {task.linked_conversation_count > 1 && (
          <span
            style={{
              fontSize: "10px",
              color: "var(--triage-text-muted)",
            }}
          >
            · {task.linked_conversation_count} conversations
          </span>
        )}
      </div>
    </div>
  );
}

export function LinkedTasksPanel({ tasks, loading }: Props) {
  const [open, setOpen] = useState(true);

  const linked = tasks.filter((t) => t.is_linked);
  const related = tasks.filter((t) => !t.is_linked);

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
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--triage-text)",
        }}
      >
        <span
          className="triage-heading"
          style={{ fontSize: "13px", color: "var(--triage-text)" }}
        >
          Tasks
          {tasks.length > 0 && (
            <span
              style={{
                marginLeft: "6px",
                fontSize: "11px",
                color: "var(--triage-text-muted)",
                fontWeight: 400,
              }}
            >
              ({tasks.length})
            </span>
          )}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div style={{ marginTop: "10px" }}>
          {loading ? (
            <p style={{ fontSize: "12px", color: "var(--triage-text-muted)" }}>
              Loading…
            </p>
          ) : tasks.length === 0 ? (
            <p style={{ fontSize: "12px", color: "var(--triage-text-muted)" }}>
              No tasks linked.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {/* Linked tasks first */}
              {linked.map((t) => (
                <TaskCard key={t.id} task={t} isLinked />
              ))}

              {/* Separator */}
              {linked.length > 0 && related.length > 0 && (
                <p
                  style={{
                    fontSize: "10px",
                    color: "var(--triage-text-muted)",
                    margin: "2px 0",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Related
                </p>
              )}

              {/* Related tasks */}
              {related.map((t) => (
                <TaskCard key={t.id} task={t} isLinked={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
