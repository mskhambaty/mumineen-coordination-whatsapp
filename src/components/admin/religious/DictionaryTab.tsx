"use client";

import LisanDictionaryUploader from "@/components/admin/LisanDictionaryUploader";
import LisanDictionaryBrowser from "./LisanDictionaryBrowser";
import { Empty, SectionCard, WordRequest, fmt } from "./ui";

// Lisan dictionary management: the missing-word queue (words members asked for that aren't in the
// dictionary) + the existing uploader (add a word / upload & replace / export CSV).
export default function DictionaryTab({
  wordRequests,
  onResolve,
}: {
  wordRequests: WordRequest[];
  onResolve: (id: string, status: "added" | "dismissed") => void;
}) {
  return (
    <div className="space-y-5">
      <SectionCard title={`Missing words (${wordRequests.length})`}>
        {wordRequests.length === 0 ? (
          <Empty>No open requests. 🎉</Empty>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {wordRequests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{r.word}</span>
                  <span className="ml-2 text-xs text-gray-400">×{r.times_seen} · {fmt(r.last_seen_at)}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button onClick={() => onResolve(r.id, "added")} className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700">Added</button>
                  <button onClick={() => onResolve(r.id, "dismissed")} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">Dismiss</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Browse / search the indexed words, with copy + inline edit / delete. */}
      <LisanDictionaryBrowser />

      {/* The dictionary editor itself (add a word · upload & replace · export CSV). */}
      <LisanDictionaryUploader />
    </div>
  );
}
