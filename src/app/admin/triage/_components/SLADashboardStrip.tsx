"use client";

// src/app/admin/triage/_components/SLADashboardStrip.tsx
// Persistent horizontal stats bar at the top of the triage board.
// Shows 5 key metrics and provides SLA configuration for admin/leadership.

import { useState, useEffect } from "react";
import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import type { SLAStats } from "./types";

// ─── StatCard ─────────────────────────────────────────────────────────────────

type StatCardProps = {
  label: string;
  value: string | number;
  filterKey: string;
  valueStyle?: React.CSSProperties;
  extraClass?: string;
  onStatClick: (filter: string) => void;
};

function StatCard({ label, value, filterKey, valueStyle, extraClass = "", onStatClick }: StatCardProps) {
  return (
    <button
      type="button"
      className={`triage-stat-pill cursor-pointer text-left ${extraClass}`}
      onClick={() => onStatClick(filterKey)}
    >
      <div
        className={`triage-display triage-mono text-2xl leading-none`}
        style={valueStyle}
      >
        {value}
      </div>
      <div className="text-xs mt-0.5" style={{ color: "var(--triage-text-muted)" }}>
        {label}
      </div>
    </button>
  );
}

// ─── SLASettingsModal ─────────────────────────────────────────────────────────

type SLAConfig = {
  urgent_minutes: number;
  normal_minutes: number;
};

type SLASettingsModalProps = {
  onClose: () => void;
};

function SLASettingsModal({ onClose }: SLASettingsModalProps) {
  const [config, setConfig] = useState<SLAConfig>({ urgent_minutes: 30, normal_minutes: 120 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await apiFetch("/api/admin/escalations/sla");
        if (res.ok) {
          const data = (await res.json()) as Record<string, { pickup_minutes: number }>;
          setConfig({
            urgent_minutes: data.urgent?.pickup_minutes ?? 30,
            normal_minutes: data.normal?.pickup_minutes ?? 120,
          });
        }
      } catch {
        // silently keep defaults
      } finally {
        setLoading(false);
      }
    }
    void loadConfig();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await apiFetch("/api/admin/escalations/sla", {
        method: "PUT",
        body: JSON.stringify({
          urgent_minutes: config.urgent_minutes,
          normal_minutes: config.normal_minutes,
        }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(onClose, 900);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to save SLA config");
      }
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  function handleMinutesChange(field: keyof SLAConfig, raw: string) {
    const v = parseInt(raw, 10);
    if (!isNaN(v)) {
      setConfig((prev) => ({ ...prev, [field]: v }));
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(26,24,22,0.4)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl shadow-lg p-6 w-80 flex flex-col gap-4"
        style={{
          background: "var(--triage-surface)",
          border: "1px solid var(--triage-border)",
          boxShadow: "var(--triage-shadow-lg)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2
            className="triage-heading text-base"
            style={{ color: "var(--triage-text)" }}
          >
            SLA Configuration
          </h2>
          <button
            type="button"
            className="rounded-md p-1 transition-colors"
            style={{ color: "var(--triage-text-muted)" }}
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: "var(--triage-text-muted)" }}>Loading…</p>
        ) : (
          <>
            {/* Urgent */}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--triage-text-secondary)" }}>
                Urgent pickup (minutes)
              </span>
              <input
                type="number"
                min={1}
                max={1440}
                value={config.urgent_minutes}
                onChange={(e) => handleMinutesChange("urgent_minutes", e.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none focus:ring-2"
                style={{
                  background: "var(--triage-surface-raised)",
                  border: "1px solid var(--triage-border)",
                  color: "var(--triage-text)",
                }}
              />
            </label>

            {/* Normal */}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--triage-text-secondary)" }}>
                Normal pickup (minutes)
              </span>
              <input
                type="number"
                min={1}
                max={1440}
                value={config.normal_minutes}
                onChange={(e) => handleMinutesChange("normal_minutes", e.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none focus:ring-2"
                style={{
                  background: "var(--triage-surface-raised)",
                  border: "1px solid var(--triage-border)",
                  color: "var(--triage-text)",
                }}
              />
            </label>

            {error && (
              <p className="text-xs" style={{ color: "var(--triage-sla-breach)" }}>{error}</p>
            )}
            {success && (
              <p className="text-xs" style={{ color: "var(--triage-sla-ok)" }}>Saved successfully</p>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: "var(--triage-text-muted)" }}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                className="text-sm px-4 py-1.5 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                style={{ background: saving ? "var(--triage-accent-hover)" : "var(--triage-accent)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--triage-accent-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!saving) {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--triage-accent)";
                  }
                }}
                onClick={handleSave}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── SLADashboardStrip ────────────────────────────────────────────────────────

type Props = {
  stats: SLAStats;
  onStatClick: (filter: string) => void;
};

export function SLADashboardStrip({ stats, onStatClick }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const adminUser = readAdminUser();
  const canManageSLA = isAdminOrLeadership(adminUser);

  // Format avg pickup as "Xm" or "—"
  const avgPickupDisplay =
    stats.avg_pickup_minutes != null
      ? `${Math.round(stats.avg_pickup_minutes)}m`
      : "—";

  // Determine avg pickup color based on urgency thresholds (warn ≥ 20m, breach ≥ 45m)
  const avgPickupColor =
    stats.avg_pickup_minutes == null
      ? "var(--triage-text-muted)"
      : stats.avg_pickup_minutes >= 45
      ? "var(--triage-sla-breach)"
      : stats.avg_pickup_minutes >= 20
      ? "var(--triage-sla-warn)"
      : "var(--triage-sla-ok)";

  return (
    <>
      <div
        className="triage-glass border-b flex items-center gap-3 px-5 py-2.5 flex-wrap"
        style={{ borderColor: "var(--triage-border)" }}
      >
        {/* Open Tickets */}
        <StatCard
          label="Open Tickets"
          value={stats.open_count}
          filterKey="open"
          valueStyle={{ color: "var(--triage-text)" }}
          onStatClick={onStatClick}
        />

        {/* Pending Pickup */}
        <StatCard
          label="Pending Pickup"
          value={stats.pending_count}
          filterKey="pending"
          valueStyle={{
            color: stats.pending_count > 0 ? "var(--triage-pending)" : "var(--triage-text)",
          }}
          onStatClick={onStatClick}
        />

        {/* Breaching SLA */}
        <StatCard
          label="Breaching SLA"
          value={stats.breaching_count}
          filterKey="breaching"
          valueStyle={{ color: stats.breaching_count > 0 ? "var(--triage-sla-breach)" : "var(--triage-text)" }}
          extraClass={stats.breaching_count > 0 ? "triage-sla-breaching" : ""}
          onStatClick={onStatClick}
        />

        {/* Avg Pickup */}
        <StatCard
          label="Avg Pickup"
          value={avgPickupDisplay}
          filterKey="avg_pickup"
          valueStyle={{ color: avgPickupColor }}
          onStatClick={onStatClick}
        />

        {/* Resolved Today */}
        <StatCard
          label="Resolved Today"
          value={stats.resolved_today_count}
          filterKey="resolved"
          valueStyle={{ color: "var(--triage-sla-ok)" }}
          onStatClick={onStatClick}
        />

        {/* Spacer + settings gear */}
        <div className="ml-auto flex items-center">
          {canManageSLA && (
            <button
              type="button"
              className="rounded-lg p-2 transition-colors"
              style={{ color: "var(--triage-text-muted)" }}
              title="SLA Settings"
              onClick={() => setShowSettings(true)}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--triage-text)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--triage-text-muted)";
              }}
            >
              {/* Gear icon */}
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                  fill="currentColor"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <SLASettingsModal onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}

export default SLADashboardStrip;
