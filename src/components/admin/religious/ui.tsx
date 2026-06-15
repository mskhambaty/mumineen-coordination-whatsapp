"use client";

import type { ReactNode } from "react";

// Shared visual primitives + types for the Waaz Talaqqi hub. Kept in one place so every tab
// renders with the same look (cards, badges, KPIs, tabs, the AI/Manual toggle, chat bubbles).

// ─── Types (mirror the /api/admin/religious/* responses) ──────────────────────────────────────
export type TabKey = "overview" | "chats" | "dictionary" | "content" | "flags" | "team";

export type Metrics = {
  summary: {
    total_calls: number;
    unique_members: number;
    waaz_questions: number;
    lisan_lookups: number;
    lisan_by_status: Record<string, number>;
    open_word_requests: number;
    unreviewed_ruling_flags: number;
  };
  top_words: { word: string; count: number }[];
  recent_gaps: { query: string; created_at: string }[];
};

// A religious_topics row (subset) — used by the Overview "Today's uploads" panel.
export type Topic = {
  id: string;
  year_hijri: string | null;
  majlis_number: number | null;
  is_ashura: boolean;
  category: string | null;
  status: string;
};
export type WordRequest = {
  id: string;
  word: string;
  times_seen: number;
  last_phone_e164: string | null;
  last_seen_at: string;
};
export type ChatMsg = { direction: string; body: string; created_at: string };
export type HandlingMode = "ai" | "manual";
export type Conversation = {
  phone: string;
  phone_last4: string;
  name: string | null;
  last_at: string | null;
  in_window: boolean;
  handling_mode: HandlingMode;
  handling_mode_at: string | null;
  messages: ChatMsg[];
};
export type RulingFlag = { phone_last4: string; message: string; detected_by: string; reviewed: boolean; created_at: string };
export type Monitor = { id: string; user: { id: string; display_name: string | null; phone_e164: string | null } | null };
export type DirectoryUser = { id: string; display_name: string | null; phone_e164: string | null };

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────
export function fmt(ts: string | null): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

type Tone = "neutral" | "amber" | "red" | "green" | "blue";

const TONE_CARD: Record<Tone, string> = {
  neutral: "border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  green: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
};
const TONE_CHIP: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300",
  red: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300",
  green: "bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-300",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300",
};

// ─── KPI card ─────────────────────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, tone = "neutral", icon }: { label: string; value: number; tone?: Tone; icon?: ReactNode }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${TONE_CARD[tone]}`}>
      {icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_CHIP[tone]}`}>{icon}</span>}
      <div className="min-w-0">
        <div className="text-2xl font-bold tabular-nums leading-none">{value.toLocaleString()}</div>
        <div className="mt-1 text-[11px] font-medium uppercase leading-tight tracking-wide opacity-70">{label}</div>
      </div>
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────────────────────
export function SectionCard({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────────────────────
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CARD[tone]}`}>{children}</span>;
}

// ─── Empty state ──────────────────────────────────────────────────────────────────────────────
export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}

// ─── Horizontal bar (top words) ───────────────────────────────────────────────────────────────
export function HBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate text-gray-800 dark:text-gray-200">{label}</span>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <span className="block h-2.5 rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-6 shrink-0 text-right tabular-nums text-gray-400">{count}</span>
    </div>
  );
}

// ─── Tabs (underline aesthetic) ───────────────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }: { tabs: { key: TabKey; label: string; badge?: number }[]; active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <>
      {/* Mobile: a dropdown (the 6 tabs don't fit a phone width). */}
      <select
        value={active}
        onChange={(e) => onChange(e.target.value as TabKey)}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 sm:hidden dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
        aria-label="Section"
      >
        {tabs.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}{t.badge ? ` (${t.badge})` : ""}
          </option>
        ))}
      </select>

      {/* Desktop: the underline tab bar. */}
      <div className="hidden gap-1 overflow-x-auto border-b border-gray-200 sm:flex dark:border-gray-800">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className={`relative flex items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm font-semibold transition-colors ${
                on ? "text-blue-700 dark:text-blue-300" : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{t.badge}</span>
              ) : null}
              {on && <span className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-t bg-blue-600 dark:bg-blue-400" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ─── AI / Manual toggle (mirrors the Inbox switch) ────────────────────────────────────────────
export function ModeToggle({ mode, onChange, disabled }: { mode: HandlingMode; onChange: (m: HandlingMode) => void; disabled?: boolean }) {
  const manual = mode === "manual";
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs font-medium ${!manual ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-gray-500"}`}>AI</span>
      <button
        type="button"
        onClick={() => onChange(manual ? "ai" : "manual")}
        disabled={disabled}
        role="switch"
        aria-checked={manual}
        aria-label="Toggle manual mode"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${manual ? "bg-amber-500" : "bg-blue-600"} disabled:opacity-50`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${manual ? "translate-x-6" : "translate-x-0.5"}`} />
      </button>
      <span className={`text-xs font-medium ${manual ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-gray-500"}`}>Manual</span>
    </div>
  );
}

// ─── Chat bubble (mirrors the Inbox thread) ───────────────────────────────────────────────────
export function MessageBubble({ direction, body, at }: { direction: string; body: string; at: string }) {
  const outbound = direction === "outbound";
  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-lg border px-4 py-3 shadow-sm ${
        outbound ? "bg-blue-600 text-white dark:bg-blue-700" : "bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      }`}>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{body || "[message]"}</p>
        <div className={`mt-2 text-xs ${outbound ? "text-blue-100" : "text-gray-400 dark:text-gray-500"}`}>{fmt(at)}</div>
      </div>
    </div>
  );
}
