"use client";

import { DirectoryUser, Empty, Monitor, SectionCard } from "./ui";

// Religious-monitor management (admins only). Add a user from the directory or remove one.
export default function TeamTab({
  monitors,
  directory,
  onAdd,
  onRemove,
}: {
  monitors: Monitor[];
  directory: DirectoryUser[];
  onAdd: (userId: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <SectionCard title={`Religious monitors (${monitors.length})`}>
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
        Monitors see only this Waaz Talaqqi area (Overview, Chats, Flags) — nothing logistics or roster.
      </p>
      <ul className="mb-4 divide-y divide-gray-100 text-sm dark:divide-gray-800">
        {monitors.map((m) => (
          <li key={m.id} className="flex items-center justify-between py-2">
            <span className="text-gray-800 dark:text-gray-200">{m.user?.display_name ?? m.user?.phone_e164 ?? "—"}</span>
            <button onClick={() => onRemove(m.id)} className="text-xs text-red-600 hover:underline dark:text-red-400">Remove</button>
          </li>
        ))}
        {monitors.length === 0 && (
          <li className="py-2">
            <Empty>No monitors yet.</Empty>
          </li>
        )}
      </ul>
      <select
        onChange={(e) => { onAdd(e.target.value); e.target.value = ""; }}
        defaultValue=""
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      >
        <option value="" disabled>Add a monitor…</option>
        {directory
          .filter((u) => !monitors.some((m) => m.user?.id === u.id))
          .map((u) => (
            <option key={u.id} value={u.id}>{u.display_name ?? u.phone_e164 ?? u.id}</option>
          ))}
      </select>
    </SectionCard>
  );
}
