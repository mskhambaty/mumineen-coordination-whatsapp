"use client";

import { Badge, Empty, RulingFlag, SectionCard, fmt } from "./ui";

// Awareness feed of personal-ruling (fatwa) questions the bot refused and flagged. Read-only.
export default function FlagsTab({ flags }: { flags: RulingFlag[] }) {
  return (
    <SectionCard title={`Ruling flags (${flags.length})`}>
      {flags.length === 0 ? (
        <Empty>No flagged ruling questions in this range.</Empty>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {flags.map((f, i) => (
            <li key={i} className="py-3">
              <p className="text-sm text-gray-800 dark:text-gray-200">{f.message}</p>
              <p className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                <span>…{f.phone_last4}</span>
                <Badge tone={f.detected_by === "classifier" ? "blue" : "neutral"}>{f.detected_by}</Badge>
                <span>{fmt(f.created_at)}</span>
                {!f.reviewed && <Badge tone="amber">new</Badge>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
