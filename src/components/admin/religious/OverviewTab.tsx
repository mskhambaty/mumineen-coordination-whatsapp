"use client";

import { ASHARA_CATEGORIES, ASHARA_ROWS, DEFAULT_ACTIVE_YEAR, majlisRowForToday } from "@/lib/knowledge/ashara-config";
import { Badge, Empty, HBar, Metrics, SectionCard, TabKey, Topic, fmt } from "./ui";

// At-a-glance, action-oriented Overview. Two audiences: managers (what content to upload today) and
// monitors (what the bot couldn't answer + what needs review). Panels gate on `canManage`.

// A "needs attention" / jump row.
function JumpRow({ tone, count, label, tab, onJump }: { tone: string; count: number; label: string; tab: TabKey; onJump: (t: TabKey) => void }) {
  return (
    <button onClick={() => onJump(tab)} className="flex w-full items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60">
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${tone}`} />
        <span className="text-gray-700 dark:text-gray-200">{label}</span>
      </span>
      <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{count}</span>
    </button>
  );
}

const STATUS_CHIP: Record<string, { tone: "green" | "amber" | "neutral"; label: string }> = {
  indexed: { tone: "green", label: "Uploaded" },
  pending_translation: { tone: "amber", label: "Needs translation" },
  placeholder: { tone: "neutral", label: "Empty" },
};

// Today's per-majlis upload status for the active year, computed from the topics list (same source
// as the Content grid).
function TodaysUploads({ topics, onJump }: { topics: Topic[]; onJump: (t: TabKey) => void }) {
  const year = DEFAULT_ACTIVE_YEAR;
  const todayIso = new Date().toISOString().slice(0, 10);
  const rowIdx = majlisRowForToday(year, todayIso);

  // 1448 rollup: how many cells are still empty / awaiting translation across the whole grid.
  const yearTopics = topics.filter((t) => t.year_hijri === year && t.category);
  const awaitingTranslation = yearTopics.filter((t) => t.status === "pending_translation").length;

  if (rowIdx == null) {
    return (
      <SectionCard title="Today's uploads">
        <p className="text-sm text-gray-600 dark:text-gray-300">No majlis scheduled for today in {year}H.</p>
        {awaitingTranslation > 0 && (
          <button onClick={() => onJump("content")} className="mt-2 text-sm text-blue-600 hover:underline dark:text-blue-400">
            {awaitingTranslation} item{awaitingTranslation !== 1 ? "s" : ""} awaiting translation across {year}H →
          </button>
        )}
      </SectionCard>
    );
  }

  const row = ASHARA_ROWS[rowIdx];
  const cellFor = (catKey: string) =>
    yearTopics.find((t) => t.category === catKey && (row.isAshura ? t.is_ashura : t.majlis_number === row.majlisNumber)) ?? null;
  const uploaded = ASHARA_CATEGORIES.filter((c) => cellFor(c.key)?.status === "indexed").length;

  return (
    <SectionCard
      title="Today's uploads"
      action={<button onClick={() => onJump("content")} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">Open Content →</button>}
    >
      <p className="mb-3 text-sm text-gray-700 dark:text-gray-200">
        <span className="font-semibold">Today is {row.label}</span> ({year}H) — {uploaded}/{ASHARA_CATEGORIES.length} uploaded
        {awaitingTranslation > 0 && <> · {awaitingTranslation} awaiting translation in {year}H</>}.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ASHARA_CATEGORIES.map((cat) => {
          const cell = cellFor(cat.key);
          const chip = STATUS_CHIP[cell?.status ?? "placeholder"] ?? STATUS_CHIP.placeholder;
          return (
            <button
              key={cat.key}
              onClick={() => onJump("content")}
              className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60"
            >
              <span className="text-gray-700 dark:text-gray-200">{cat.label}</span>
              <Badge tone={chip.tone}>{chip.label}</Badge>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

export default function OverviewTab({
  metrics,
  topics,
  canManage,
  onJump,
}: {
  metrics: Metrics | null;
  topics: Topic[];
  canManage: boolean;
  onJump: (tab: TabKey) => void;
}) {
  const s = metrics?.summary;
  const topMax = metrics?.top_words.reduce((m, w) => Math.max(m, w.count), 0) ?? 0;
  const gaps = metrics?.recent_gaps ?? [];
  const notFound = s?.lisan_by_status?.not_found ?? 0;
  const lookups = s?.lisan_lookups ?? 0;
  const missRate = lookups > 0 ? Math.round((notFound / lookups) * 100) : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Today's uploads — managers only (needs content access) */}
      {canManage && (
        <div className="lg:col-span-2">
          <TodaysUploads topics={topics} onJump={onJump} />
        </div>
      )}

      {/* Content gaps — the actionable "add this" list */}
      <SectionCard title="Content gaps — questions the bot couldn't answer">
        {gaps.length === 0 ? (
          <Empty>No unanswered Waaz questions in this range. 🎉</Empty>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {gaps.map((g, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="text-gray-800 dark:text-gray-200">{g.query}</span>
                <span className="shrink-0 text-xs text-gray-400">{fmt(g.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Add these to the Content tab so the bot can answer them next time.</p>
      </SectionCard>

      {/* Needs attention */}
      <SectionCard title="Needs attention">
        <div className="space-y-2">
          <JumpRow tone="bg-amber-500" count={s?.open_word_requests ?? 0} label="Missing words to add" tab="dictionary" onJump={onJump} />
          <JumpRow tone="bg-red-500" count={s?.unreviewed_ruling_flags ?? 0} label="Ruling flags to review" tab="flags" onJump={onJump} />
        </div>
      </SectionCard>

      {/* Top words + hit rate */}
      <SectionCard
        title="Top words asked"
        className="lg:col-span-2"
        action={<span className="text-xs text-gray-400 dark:text-gray-500">{notFound} not found / {lookups} lookups · {missRate}% miss</span>}
      >
        {!metrics?.top_words.length ? (
          <Empty>No lookups in this range yet.</Empty>
        ) : (
          <div className="space-y-2.5">
            {metrics.top_words.map((w) => (
              <HBar key={w.word} label={w.word} count={w.count} max={topMax} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
