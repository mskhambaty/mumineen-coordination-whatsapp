"use client";

import { useState } from "react";
import type { DeptContact } from "./types";

type Props = {
  departmentName: string | null;
  contacts: DeptContact[];
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access denied — silently ignore
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        background: "none",
        border: "none",
        padding: "0 0 0 6px",
        fontSize: "11px",
        fontWeight: 500,
        color: "var(--triage-accent)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "opacity 0.15s ease",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function DepartmentContactsPanel({ departmentName, contacts }: Props) {
  if (contacts.length === 0) return null;

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
          marginBottom: "10px",
        }}
      >
        {departmentName ? `${departmentName} Contacts` : "Department Contacts"}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {contacts.map((contact, i) => (
          <div
            key={i}
            style={{
              background: "var(--triage-surface-raised)",
              border: "1px solid var(--triage-border)",
              borderRadius: "8px",
              padding: "10px 12px",
            }}
          >
            {/* Name + role */}
            <div style={{ marginBottom: "6px" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--triage-text)",
                }}
              >
                {contact.name}
              </span>
              {contact.role && (
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--triage-text-secondary)",
                    marginLeft: "6px",
                  }}
                >
                  · {contact.role}
                </span>
              )}
            </div>

            {/* Phone */}
            {contact.phone_e164 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "3px",
                }}
              >
                <span
                  className="triage-mono"
                  style={{
                    fontSize: "11px",
                    color: "var(--triage-text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {contact.phone_e164}
                </span>
                <CopyButton value={contact.phone_e164} />
              </div>
            )}

            {/* Email */}
            {contact.email && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "3px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--triage-text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {contact.email}
                </span>
                <CopyButton value={contact.email} />
              </div>
            )}

            {/* Notes */}
            {contact.notes && (
              <p
                style={{
                  fontSize: "11px",
                  color: "var(--triage-text-muted)",
                  fontStyle: "italic",
                  margin: "6px 0 0",
                }}
              >
                {contact.notes}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
