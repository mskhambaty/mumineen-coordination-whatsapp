"use client";

import { useState } from "react";

type UserProfile = {
  registration_status: string | null;
  member_count: number;
  local_or_outstation: string | null;
  city: string | null;
  jamaat: string | null;
};

type Props = {
  profile: UserProfile | null;
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

type RowProps = {
  label: string;
  value: string | number | null | undefined;
};

function ProfileRow({ label, value }: RowProps) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "8px",
        padding: "4px 0",
        borderBottom: "1px solid var(--triage-border-subtle)",
      }}
    >
      <span
        style={{
          fontSize: "11px",
          color: "var(--triage-text-muted)",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "12px",
          color: "var(--triage-text)",
          fontWeight: 500,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function UserProfilePanel({ profile, loading }: Props) {
  const [open, setOpen] = useState(true);

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
          User Profile
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div style={{ marginTop: "10px" }}>
          {loading ? (
            <p
              style={{
                fontSize: "12px",
                color: "var(--triage-text-muted)",
              }}
            >
              Loading…
            </p>
          ) : !profile ? (
            <p
              style={{
                fontSize: "12px",
                color: "var(--triage-text-muted)",
              }}
            >
              No profile found.
            </p>
          ) : (
            <div>
              <ProfileRow label="Status" value={profile.registration_status} />
              <ProfileRow label="Members" value={profile.member_count} />
              <ProfileRow label="Type" value={profile.local_or_outstation} />
              <ProfileRow label="City" value={profile.city} />
              <ProfileRow label="Jamaat" value={profile.jamaat} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
