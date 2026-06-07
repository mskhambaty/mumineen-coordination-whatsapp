"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import { RELAY_UPDATE_CATEGORIES } from "@/lib/relay-updates/shared";

type Update = {
  id: string;
  date: string;
  title: string;
  body: string;
  category: string;
  link: string | null;
  cta: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
  creator: { display_name: string | null } | null;
};

type Draft = { id?: string; date: string; title: string; body: string; category: string; link: string; cta: string; published: boolean };

const CATEGORY_BADGE: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  schedule: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  travel: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  advisory: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
};

function emptyDraft(): Draft {
  return { date: new Date().toISOString().slice(0, 10), title: "", body: "", category: "advisory", link: "", cta: "", published: true };
}

export default function RelayUpdatesPage() {
  const router = useRouter();
  const [userId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const user = JSON.parse(localStorage.getItem("admin_user") ?? "null") as { id?: string } | null;
      return user?.id ?? "";
    } catch {
      return "";
    }
  });
  const [updates, setUpdates] = useState<Update[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/admin/relay-updates");
    const data = await res.json().catch(() => ({}));
    if (res.ok) setUpdates(data.updates ?? []);
    else setError(data.error ?? "Failed to load updates");
    setLoading(false);
  }, []);

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    if (!isAdminOrLeadership(user)) {
      router.push("/admin");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [router, load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const isEdit = Boolean(draft.id);
    const res = await apiFetch(isEdit ? `/api/admin/relay-updates/${draft.id}` : "/api/admin/relay-updates", {
      method: isEdit ? "PUT" : "POST",
      body: JSON.stringify({ ...draft, user_id: userId }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Save failed");
      return;
    }
    setDraft(null);
    void load();
  }

  async function togglePublished(u: Update) {
    setError(null);
    const res = await apiFetch(`/api/admin/relay-updates/${u.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...u, published: !u.published, user_id: userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Update failed");
      return;
    }
    void load();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold dark:text-gray-100">Relay Updates</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Posted to the public relay-center page&apos;s &quot;Latest updates&quot; section and indexed for the WhatsApp agent.
          </p>
        </div>
        <button
          onClick={() => setDraft(emptyDraft())}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New Update
        </button>
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {["Date", "Title", "Category", "Status", "By", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
              {updates.map((u) => (
                <tr key={u.id}>
                  <td className="whitespace-nowrap px-4 py-3 dark:text-gray-200">{u.date}</td>
                  <td className="px-4 py-3 dark:text-gray-200">
                    <div className="font-medium">{u.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{u.body}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_BADGE[u.category] ?? ""}`}>
                      {u.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.published ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                      {u.published ? "Published" : "Unpublished"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{u.creator?.display_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <button onClick={() => setDraft({ id: u.id, date: u.date, title: u.title, body: u.body, category: u.category, link: u.link ?? "", cta: u.cta ?? "", published: u.published })} className="text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                    <button onClick={() => togglePublished(u)} className="ml-3 text-gray-600 hover:underline dark:text-gray-300">
                      {u.published ? "Unpublish" : "Publish"}
                    </button>
                  </td>
                </tr>
              ))}
              {updates.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No updates yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
            <h2 className="text-lg font-semibold dark:text-gray-100">{draft.id ? "Edit Update" : "New Update"}</h2>
            <div className="mt-4 space-y-4">
              <div className="flex gap-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Date
                  <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="mt-1 block rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
                </label>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Category
                  <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="mt-1 block rounded-md border px-3 py-2 capitalize dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                    {RELAY_UPDATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Title
                <input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-1 block w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Body
                <textarea value={draft.body} maxLength={1000} rows={4} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="mt-1 block w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Link (optional — card shows a CTA button to this URL)
                <input type="url" value={draft.link} maxLength={500} placeholder="https://…" onChange={(e) => setDraft({ ...draft, link: e.target.value })} className="mt-1 block w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                CTA label (optional — requires a link; page default otherwise)
                <input value={draft.cta} maxLength={80} placeholder="View your zone" disabled={!draft.link.trim()} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} className="mt-1 block w-full rounded-md border px-3 py-2 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} />
                Published
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setDraft(null)} className="rounded-md border px-4 py-2 text-sm dark:border-gray-700 dark:text-gray-300">Cancel</button>
              <button onClick={save} disabled={saving || !draft.title.trim() || !draft.body.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
