"use client";

import type { Department, Filters, TeamMember } from "./types";

type PillToggleProps = {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
};

function PillToggle({ options, value, onChange }: PillToggleProps) {
  return (
    <div
      style={{
        display: "flex",
        borderRadius: "6px",
        border: "1px solid var(--triage-border)",
        overflow: "hidden",
      }}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: isActive ? 600 : 400,
              lineHeight: "16px",
              border: "none",
              cursor: "pointer",
              transition: "background 0.15s ease, color 0.15s ease",
              background: isActive ? "var(--triage-accent)" : "transparent",
              color: isActive ? "#ffffff" : "var(--triage-text-secondary)",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--triage-surface-hover)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type Props = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  teamMembers: TeamMember[];
  departments: Department[];
  categories: string[];
};

const selectStyle: React.CSSProperties = {
  background: "var(--triage-surface)",
  border: "1px solid var(--triage-border)",
  color: "var(--triage-text)",
  borderRadius: "6px",
  fontSize: "12px",
  padding: "4px 8px",
  lineHeight: "16px",
  outline: "none",
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  color: "var(--triage-text-muted)",
  fontSize: "12px",
  fontWeight: 500,
  lineHeight: "16px",
  whiteSpace: "nowrap",
};

const groupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
};

export function FilterBar({
  filters,
  onFiltersChange,
  teamMembers,
  departments,
  categories,
}: Props) {
  function set<K extends keyof Filters>(key: K, val: Filters[K]) {
    onFiltersChange({ ...filters, [key]: val });
  }

  const priorityOptions = [
    { value: "all", label: "All" },
    { value: "urgent", label: "Urgent" },
    { value: "normal", label: "Normal" },
  ];

  return (
    <div
      style={{
        background: "var(--triage-surface-raised)",
        borderBottom: "1px solid var(--triage-border)",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: "20px",
        flexWrap: "wrap",
      }}
    >
      {/* Assignee */}
      <div style={groupStyle}>
        <span style={labelStyle}>Assignee</span>
        <select
          style={selectStyle}
          value={filters.assignee}
          onChange={(e) => set("assignee", e.target.value)}
        >
          <option value="all">All</option>
          <option value="unassigned">Unassigned</option>
          {teamMembers.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </div>

      {/* Priority */}
      <div style={groupStyle}>
        <span style={labelStyle}>Priority</span>
        <PillToggle
          options={priorityOptions}
          value={filters.priority}
          onChange={(val) => set("priority", val)}
        />
      </div>

      {/* Category */}
      <div style={groupStyle}>
        <span style={labelStyle}>Category</span>
        <select
          style={selectStyle}
          value={filters.category}
          onChange={(e) => set("category", e.target.value)}
        >
          <option value="all">All</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Department */}
      <div style={groupStyle}>
        <span style={labelStyle}>Department</span>
        <select
          style={selectStyle}
          value={filters.department}
          onChange={(e) => set("department", e.target.value)}
        >
          <option value="all">All</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
