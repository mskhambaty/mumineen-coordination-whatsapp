"use client";

import { Conversation, Empty, HBar, Metrics, RulingFlag, SectionCard, TabKey, WordRequest, fmt } from "./ui";

// A clickable "needs attention" row that jumps to the relevant tab. Module-level so it isn't
// recreated on every render.
function AttnRow({ tone, count, label, tab, onJump }: { tone: string; count: number; label: string; tab: TabKey; onJump: (t: TabKey) => void }) {
  return (
    <button
      onClick={() => onJump(tab)}
      className="flex w-full items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60"
    >
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${tone}`} />
        <span className="text-gray-700 dark:text-gray-200">{label}</span>
      </span>
      <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{count}</span>
    </button>
  );
}

// At-a-glance tab: top words, a "needs attention" panel that jumps to the relevant tab, and a
// recent-activity feed derived from the loaded conversations (no extra fetch).
export default function OverviewTab({
  metrics,
  wordRequests,
  flags,
  conversations,
  onJump,
}: {
  metrics: Metrics | null;
  wordRequests: WordRequest[];
  flags: RulingFlag[];
  conversations: Conversation[];
  onJump: (tab: TabKey) => void;
}) {
  const topMax = metrics?.top_words.reduce((m, w) => Math.max(m, w.count), 0) ?? 0;
  const outOfWindow = conversations.filter((c) => !c.in_window).length;
  const recent = [...conversations]
    .filter((c) => c.last_at)
    .sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""))
    .slice(0, 8);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <SectionCard title="Top words asked">
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

      <SectionCard title="Needs attention">
        <div className="space-y-2">
          <AttnRow tone="bg-amber-500" count={metrics?.summary.open_word_requests ?? wordRequests.length} label="Missing words to add" tab="dictionary" onJump={onJump} />
          <AttnRow tone="bg-red-500" count={metrics?.summary.unreviewed_ruling_flags ?? flags.length} label="Ruling flags to review" tab="flags" onJump={onJump} />
          <AttnRow tone="bg-gray-400" count={outOfWindow} label="Chats outside the 24h window" tab="chats" onJump={onJump} />
        </div>
      </SectionCard>

      <SectionCard title="Recent activity" className="lg:col-span-2">
        {recent.length === 0 ? (
          <Empty>No religious chats in this range.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {recent.map((c) => {
              const last = c.messages[c.messages.length - 1];
              return (
                <li key={c.phone}>
                  <button onClick={() => onJump("chats")} className="flex w-full items-center justify-between gap-4 py-2 text-left">
                    <span className="min-w-0">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{c.name ?? `…${c.phone_last4}`}</span>
                      <span className="ml-2 truncate text-sm text-gray-500 dark:text-gray-400">{last?.body ?? ""}</span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">{fmt(c.last_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
