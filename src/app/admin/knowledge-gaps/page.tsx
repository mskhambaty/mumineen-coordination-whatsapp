"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { canManageKnowledge } from "@/lib/admin/access";

type Gap = {
  id: string;
  topic: string;
  sample_question: string | null;
  status: "open" | "addressed" | "dismissed";
  times_seen: number;
  first_seen_at: string;
  last_seen_at: string;
};

type StatusFilter = "open" | "addressed" | "dismissed" | "all";

const TABS: StatusFilter[] = ["open", "addressed", "dismissed", "all"];

export default function KnowledgeGapsPage() {
  const router = useRouter();
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faqGap, setFaqGap] = useState<Gap | null>(null);
  const [faqTitle, setFaqTitle] = useState("");
  const [faqAnswer, setFaqAnswer] = useState("");
  const [faqDeptId, setFaqDeptId] = useState("");
  const [savingFaq, setSavingFaq] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  const load = useCallback(
    async (status: StatusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/knowledge-gaps?status=${status}`, { headers: { "x-admin-key": adminKey } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setGaps((data.gaps as Gap[]) ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
        setGaps([]);
      } finally {
        setLoading(false);
      }
    },
    [adminKey],
  );

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const raw = localStorage.getItem("admin_user");
    const user = raw ? (JSON.parse(raw) as { role?: string; global_role?: string; is_manager?: boolean }) : null;
    if (!canManageKnowledge(user)) {
      router.push("/admin/conversations");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter);
  }, [router, filter, load]);

  // Load departments once for the optional Add FAQ dropdown.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/departments", { headers: { "x-admin-key": adminKey } });
        if (!res.ok) return;
        const data = (await res.json()) as { id: string; name: string }[];
        setDepartments(Array.isArray(data) ? data : []);
      } catch {
        // Non-fatal: the dropdown just shows "No department".
      }
    })();
  }, [adminKey]);

  async function setStatus(id: string, status: Gap["status"]) {
    setError(null);
    try {
      const res = await fetch("/api/admin/knowledge-gaps", {
        method: "PATCH",
        headers: { "x-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      await load(filter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  function openFaq(gap: Gap) {
    setFaqGap(gap);
    setFaqTitle(gap.topic);
    setFaqAnswer("");
    setFaqDeptId("");
    setError(null);
  }

  function closeFaq() {
    setFaqGap(null);
    setFaqTitle("");
    setFaqAnswer("");
    setFaqDeptId("");
  }

  async function saveFaq(event: React.FormEvent) {
    event.preventDefault();
    if (!faqGap || !faqTitle.trim() || !faqAnswer.trim()) return;
    setSavingFaq(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/knowledge-gaps/faq", {
        method: "POST",
        headers: { "x-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify({
          gap_id: faqGap.id,
          title: faqTitle.trim(),
          question: faqGap.sample_question ?? "",
          answer: faqAnswer.trim(),
          department_id: faqDeptId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save FAQ");
      closeFaq();
      await load(filter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save FAQ");
    } finally {
      setSavingFaq(false);
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Knowledge Gaps</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Topics the AI assistant couldn&apos;t answer from indexed content. Add an FAQ for the
            common ones (it&apos;s vectorized instantly), or edit the agent prompt — then mark them addressed.
          </p>
        </div>
        <Link
          href="/admin/prompt"
          className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Edit agent prompt
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${
              filter === t
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !gaps || gaps.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No {filter === "all" ? "" : filter} knowledge gaps.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-400 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2">Topic</th>
                <th className="px-3 py-2">Example question</th>
                <th className="px-3 py-2 text-center">Asked</th>
                <th className="px-3 py-2">Last</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 font-medium">{g.topic}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{g.sample_question ?? "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex min-w-6 justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{g.times_seen}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{fmt(g.last_seen_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => openFaq(g)} className="rounded border border-blue-300 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950">Add FAQ</button>
                      {g.status !== "addressed" && (
                        <button type="button" onClick={() => setStatus(g.id, "addressed")} className="rounded border border-green-300 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-50 dark:border-green-900 dark:hover:bg-green-950">Addressed</button>
                      )}
                      {g.status !== "dismissed" && (
                        <button type="button" onClick={() => setStatus(g.id, "dismissed")} className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Dismiss</button>
                      )}
                      {g.status !== "open" && (
                        <button type="button" onClick={() => setStatus(g.id, "open")} className="rounded border border-blue-300 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-900 dark:hover:bg-blue-950">Reopen</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {faqGap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 dark:bg-gray-900">
            <h3 className="text-lg font-semibold">Add FAQ</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This is vectorized into the logistics store immediately so the agent can answer it next time. The gap is marked addressed on save.
            </p>
            {faqGap.sample_question && (
              <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                <span className="font-medium">Example question:</span> {faqGap.sample_question}
              </p>
            )}
            <form onSubmit={saveFaq} className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Title
                <input
                  type="text"
                  value={faqTitle}
                  onChange={(e) => setFaqTitle(e.target.value)}
                  required
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Department <span className="font-normal text-gray-400">(optional)</span>
                <select
                  value={faqDeptId}
                  onChange={(e) => setFaqDeptId(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Answer
                <textarea
                  value={faqAnswer}
                  onChange={(e) => setFaqAnswer(e.target.value)}
                  required
                  rows={6}
                  placeholder="Write the answer the agent should give for this topic."
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={closeFaq} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">Cancel</button>
                <button
                  type="submit"
                  disabled={savingFaq || !faqTitle.trim() || !faqAnswer.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {savingFaq ? "Saving…" : "Save & Vectorize"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
