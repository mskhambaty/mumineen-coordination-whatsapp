"use client";

import { useState } from "react";
import type { ToolCall } from "./types";

type Props = {
  toolCalls: ToolCall[];
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

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

export function ToolCallsPanel({ toolCalls }: Props) {
  const [open, setOpen] = useState(false);

  const sorted = [...toolCalls].sort(
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
          AI Tool Calls
          {toolCalls.length > 0 && (
            <span
              style={{
                marginLeft: "6px",
                fontSize: "11px",
                color: "var(--triage-text-muted)",
                fontWeight: 400,
              }}
            >
              ({toolCalls.length})
            </span>
          )}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div style={{ marginTop: "10px" }}>
          {sorted.length === 0 ? (
            <p style={{ fontSize: "12px", color: "var(--triage-text-muted)" }}>
              No tool calls recorded.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {sorted.map((tc) => (
                <div
                  key={tc.id}
                  style={{
                    background: "var(--triage-surface-raised)",
                    border: "1px solid var(--triage-border)",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                >
                  {/* Tool name + badge + timestamp */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      flexWrap: "wrap",
                      marginBottom: "4px",
                    }}
                  >
                    <span
                      className="triage-mono"
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--triage-text)",
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tc.tool_name}
                    </span>

                    {/* Allowed / blocked badge */}
                    <span
                      className={tc.allowed ? "triage-badge-resolved" : "triage-badge-pending"}
                      style={{
                        padding: "2px 7px",
                        borderRadius: "9999px",
                        fontSize: "10px",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {tc.allowed ? "Allowed" : "Blocked"}
                    </span>

                    <span
                      style={{
                        fontSize: "10px",
                        color: "var(--triage-text-muted)",
                        flexShrink: 0,
                      }}
                    >
                      {timeAgo(tc.created_at)}
                    </span>
                  </div>

                  {/* Result summary */}
                  {tc.result_summary && (
                    <p
                      style={{
                        fontSize: "11px",
                        color: "var(--triage-text-secondary)",
                        margin: 0,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {tc.result_summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
