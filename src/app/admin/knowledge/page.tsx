"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import ContentBucketEditor from "@/components/admin/ContentBucketEditor";
import FaqBucketEditor from "@/components/admin/FaqBucketEditor";
import LisanDictionaryUploader from "@/components/admin/LisanDictionaryUploader";

type Department = { id: string; name: string };

type FaqBucket = {
  department_id: string;
  department_name: string;
  content: string;
  chunk_count: number;
  entry_count: number;
  updated_at: string | null;
};

type ReligiousTopic = {
  id: string;
  slug: string;
  title: string;
  content: string;
  chunk_count: number;
  entry_count: number;
  sort_order: number;
  source_url: string | null;
  source_label: string | null;
  category: string | null;
  majlis_number: number | null;
  is_ashura: boolean;
  updated_at: string | null;
};

// Per-majlis Ashara content is managed in the dedicated /admin/ashara dashboard, so we
// hide those blocks here to keep this list focused on the few standalone helper topics.
const MAJLIS_CATEGORIES = new Set(["reflection", "tazyeen", "al_dars", "jumla", "kalema", "unwaan"]);
function isMajlisBlock(t: ReligiousTopic): boolean {
  return !!t.category && MAJLIS_CATEGORIES.has(t.category) && (t.majlis_number != null || t.is_ashura);
}

type KnowledgeDoc = {
  id: string;
  title: string;
  filename: string | null;
  file_type: string;
  store?: "logistics" | "religious";
  status: "processing" | "indexed" | "failed";
  chunk_count: number;
  error: string | null;
  created_at: string;
  department: { name: string } | null;
  uploader: { display_name: string | null } | null;
};

type Tab = "faq" | "religious";

const STATUS_CLASSES: Record<KnowledgeDoc["status"], string> = {
  indexed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  processing: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function KnowledgePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("faq");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [logisticsDocs, setLogisticsDocs] = useState<KnowledgeDoc[]>([]);
  const [religiousDocs, setReligiousDocs] = useState<KnowledgeDoc[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [buckets, setBuckets] = useState<FaqBucket[]>([]);
  const [editing, setEditing] = useState<FaqBucket | null>(null);
  // Expandable per-document content viewer: which doc is open, and its loaded chunks (or "loading").
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [docChunks, setDocChunks] = useState<Record<string, { section: string; content: string }[] | "loading" | "error">>({});
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);

  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveSyncMsg, setDriveSyncMsg] = useState<string | null>(null);

  const [topics, setTopics] = useState<ReligiousTopic[]>([]);
  const [editingTopic, setEditingTopic] = useState<ReligiousTopic | null>(null);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);

  const learnedFaqCount = logisticsDocs.filter((d) => d.file_type === "faq").length;
  const documents = tab === "faq" ? logisticsDocs : religiousDocs;

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    if (!canAccessPortal(user)) {
      router.push("/admin/conversations");
      return;
    }
    void load();

  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [logRes, relRes, deptRes, bucketsRes, topicsRes] = await Promise.all([
        apiFetch("/api/knowledge?store=logistics"),
        apiFetch("/api/knowledge?store=religious"),
        apiFetch("/api/departments"),
        apiFetch("/api/admin/faq-buckets"),
        apiFetch("/api/admin/religious-topics"),
      ]);
      const logData = await logRes.json().catch(() => ({}));
      if (!logRes.ok) throw new Error(logData.error ?? "Failed to load documents");
      setLogisticsDocs((logData.documents ?? []) as KnowledgeDoc[]);
      if (relRes.ok) setReligiousDocs(((await relRes.json()).documents ?? []) as KnowledgeDoc[]);
      if (deptRes.ok) setDepartments((await deptRes.json()) as Department[]);
      if (bucketsRes.ok) setBuckets(((await bucketsRes.json()).buckets ?? []) as FaqBucket[]);
      if (topicsRes.ok) setTopics(((await topicsRes.json()).topics ?? []) as ReligiousTopic[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }

  async function migrateLearned() {
    setMigrating(true);
    setMigrateMsg(null);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/faq-buckets", {
        method: "POST",
        body: JSON.stringify({ action: "migrate" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not sort FAQs");
      setMigrateMsg(`Sorted ${data.migrated ?? 0} FAQ(s) into ${data.departments ?? 0} department bucket(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sort FAQs");
    } finally {
      setMigrating(false);
    }
  }

  async function runDriveSync(dryRun: boolean) {
    setDriveSyncing(true);
    setDriveSyncMsg(null);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/knowledge/drive-sync?dryRun=${dryRun}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "Drive sync failed");
      const s = (data.stats ?? {}) as {
        dryRun?: boolean;
        scanned?: number;
        added?: number;
        updated?: number;
        skipped?: number;
        deleted?: number;
        errors?: unknown[];
        note?: string;
      };
      if (s.note) {
        setDriveSyncMsg(s.note);
        return;
      }
      const parts = [`${s.added ?? 0} added`, `${s.updated ?? 0} updated`, `${s.skipped ?? 0} skipped`];
      if (s.deleted) parts.push(`${s.deleted} removed`);
      let msg = `${s.dryRun ? "Dry run — would apply:" : "Synced:"} ${parts.join(", ")} (scanned ${s.scanned ?? 0}).`;
      if (s.errors?.length) msg += ` ⚠️ ${s.errors.length} error(s) — check logs.`;
      setDriveSyncMsg(msg);
      if (!s.dryRun) await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drive sync failed");
    } finally {
      setDriveSyncing(false);
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (tab === "faq" && !departmentId) {
      setError("Please select a department for this document.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      if (tab === "faq") {
        body.append("department_id", departmentId);
      } else {
        body.append("store", "religious");
      }
      if (title.trim()) body.append("title", title.trim());
      try {
        const userRaw = localStorage.getItem("admin_user");
        const uid = userRaw ? (JSON.parse(userRaw) as { id?: string }).id : undefined;
        if (uid) body.append("uploaded_by", uid);
      } catch {
        // no stored user id; upload without attribution
      }

      const res = await apiFetch("/api/knowledge", {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      setTitle("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove(doc: KnowledgeDoc) {
    if (!window.confirm(`Delete "${doc.title}"? Its content will be removed from the AI's knowledge.`)) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/knowledge/${doc.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete");
      }
      const filterOut = (items: KnowledgeDoc[]) => items.filter((item) => item.id !== doc.id);
      if (tab === "faq") setLogisticsDocs(filterOut); else setReligiousDocs(filterOut);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function toggleDocContent(doc: KnowledgeDoc) {
    if (expandedDoc === doc.id) {
      setExpandedDoc(null);
      return;
    }
    setExpandedDoc(doc.id);
    if (docChunks[doc.id] && docChunks[doc.id] !== "error") return; // already loaded
    setDocChunks((prev) => ({ ...prev, [doc.id]: "loading" }));
    try {
      const res = await apiFetch(`/api/knowledge/${doc.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load content");
      setDocChunks((prev) => ({ ...prev, [doc.id]: (data.chunks ?? []) as { section: string; content: string }[] }));
    } catch {
      setDocChunks((prev) => ({ ...prev, [doc.id]: "error" }));
    }
  }

  async function addTopic() {
    const titleText = newTopicTitle.trim();
    if (!titleText) return;
    setAddingTopic(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/religious-topics", {
        method: "POST",
        body: JSON.stringify({ title: titleText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add topic");
      setNewTopicTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add topic");
    } finally {
      setAddingTopic(false);
    }
  }

  async function deleteTopic(topic: ReligiousTopic) {
    if (!window.confirm(`Delete the "${topic.title}" topic? Its content will be removed from the AI's knowledge.`)) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/religious-topics/${topic.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete topic");
      }
      setTopics((items) => items.filter((t) => t.id !== topic.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete topic");
    }
  }

  const tabBtn = (value: Tab, label: string) => (
    <button
      type="button"
      onClick={() => { setTab(value); setError(null); }}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        tab === value
          ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
          : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Knowledge Base</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Content the WhatsApp agent retrieves from. Each tab feeds a separate vector store so
          logistics and Waaz Talaqi answers never mix.
        </p>
      </div>

      <div className="mb-6 flex gap-2 border-b border-gray-200 dark:border-gray-800">
        {tabBtn("faq", "FAQ & Guides")}
        {tabBtn("religious", "Waaz Talaqi")}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <form
        onSubmit={upload}
        className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 className="text-lg font-semibold">
          {tab === "faq" ? "Upload a document" : "Upload Waaz Talaqi content"}
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Title (optional)
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={tab === "faq" ? "e.g. Transportation FAQ" : "e.g. Reflections — Majlis 1"}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>
          {tab === "faq" && (
            <label className="text-sm text-gray-700 dark:text-gray-300">
              Department <span className="text-red-500">*</span>
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">Select a department…</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.docx,.pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 dark:text-gray-300"
          />
          <button
            type="submit"
            disabled={!file || (tab === "faq" && !departmentId) || uploading}
            className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            {uploading ? "Indexing..." : "Upload & Index"}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          CSV, Excel (.xlsx/.xls), Word (.docx), or PDF, up to 15 MB. Scanned/image-only PDFs can&apos;t be read.
        </p>
      </form>

      {tab === "faq" && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Google Drive sync</h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                Pull FAQ docs from the shared Drive “WhatsApp” folder into the knowledge base. Run a
                <strong> Dry run</strong> first to preview what would change — it reads only, and writes nothing.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void runDriveSync(true)}
                disabled={driveSyncing}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {driveSyncing ? "Working…" : "Dry run"}
              </button>
              <button
                type="button"
                onClick={() => void runDriveSync(false)}
                disabled={driveSyncing}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                {driveSyncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </div>
          {driveSyncMsg && <p className="mt-3 text-sm font-medium text-green-700 dark:text-green-400">{driveSyncMsg}</p>}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 className="font-semibold">Indexed documents</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-800/60">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Title</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Type</th>
                {tab === "faq" && (
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Department</th>
                )}
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Chunks</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Uploaded by</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Uploaded</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={tab === "faq" ? 8 : 7} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading...</td></tr>
              ) : documents.length === 0 ? (
                <tr><td colSpan={tab === "faq" ? 8 : 7} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No documents yet. Upload one above.</td></tr>
              ) : (
                documents.flatMap((doc) => {
                  const colSpan = tab === "faq" ? 8 : 7;
                  const rows = [
                    <tr key={doc.id}>
                      <td className="px-5 py-4 text-sm font-medium" title={doc.error ?? undefined}>{doc.title}</td>
                      <td className="px-5 py-4 text-sm uppercase text-gray-500 dark:text-gray-400">{doc.file_type}</td>
                      {tab === "faq" && (
                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.department?.name ?? "—"}</td>
                      )}
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[doc.status]}`}>{doc.status}</span>
                        {doc.status === "failed" && doc.error && (
                          <span className="mt-1 block max-w-xs text-xs text-red-600 dark:text-red-400">{doc.error}</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.chunk_count}</td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {doc.uploader?.display_name ?? (doc.file_type === "faq" ? "Learned from chat" : "—")}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">{formatDate(doc.created_at)}</td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {doc.status === "indexed" && (
                            <button
                              type="button"
                              onClick={() => void toggleDocContent(doc)}
                              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                            >
                              {expandedDoc === doc.id ? "Hide" : "View"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void remove(doc)}
                            className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>,
                  ];
                  if (expandedDoc === doc.id) {
                    const content = docChunks[doc.id];
                    rows.push(
                      <tr key={`${doc.id}-content`} className="bg-gray-50 dark:bg-gray-800/40">
                        <td colSpan={colSpan} className="px-5 py-4">
                          {content === "loading" || content === undefined ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400">Loading content…</p>
                          ) : content === "error" ? (
                            <p className="text-sm text-red-600 dark:text-red-400">Could not load content.</p>
                          ) : content.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400">No indexed chunks for this document.</p>
                          ) : (
                            <div className="space-y-3">
                              {content.map((chunk, i) => (
                                <div key={chunk.section ?? i} className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Chunk {i + 1}</div>
                                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-700 dark:text-gray-300">{chunk.content}</pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>,
                    );
                  }
                  return rows;
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {tab === "faq" ? (
        <section className="mt-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">FAQ by Department</h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                Organized, editable Q&amp;A per department. Click a department to view and edit its FAQ; saving re-indexes it for the agent.
              </p>
            </div>
            {learnedFaqCount > 0 && (
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => void migrateLearned()}
                  disabled={migrating}
                  className="rounded-md border border-blue-500 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                >
                  {migrating ? "Sorting…" : `Sort ${learnedFaqCount} learned FAQ(s) into departments`}
                </button>
              </div>
            )}
          </div>
          {migrateMsg && <p className="mt-2 text-sm font-medium text-green-700 dark:text-green-400">{migrateMsg}</p>}

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {buckets.map((bucket) => (
              <button
                key={bucket.department_id}
                type="button"
                onClick={() => setEditing(bucket)}
                className="flex flex-col items-start rounded-lg border border-gray-200 bg-gray-50 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
              >
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{bucket.department_name}</span>
                <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {bucket.entry_count > 0 ? `${bucket.entry_count} FAQ${bucket.entry_count !== 1 ? "s" : ""}` : "Empty — add FAQs"}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">FAQ by Topic</h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                Standalone editable blocks (Vaaz Talaqi help, Lisan ud Dawat meanings, guardrails). Click a topic to
                edit it; saving re-indexes it for the agent.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                value={newTopicTitle}
                onChange={(e) => setNewTopicTitle(e.target.value)}
                placeholder="New topic title…"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={() => void addTopic()}
                disabled={!newTopicTitle.trim() || addingTopic}
                className="rounded-md border border-blue-500 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                {addingTopic ? "Adding…" : "Add topic"}
              </button>
            </div>
          </div>

          <a
            href="/admin/ashara"
            className="mt-4 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 hover:border-blue-400 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
          >
            <span><span className="font-semibold">Ashara majlis content</span> (Reflections, Tazyeen, Al-Dars, Jumla, Kalema, Unwaan — per majlis) is managed in the Ashara Daily Content dashboard.</span>
            <span className="ml-3 shrink-0 font-medium">Open dashboard →</span>
          </a>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {topics.filter((t) => !isMajlisBlock(t)).map((topic) => (
              <div
                key={topic.id}
                className="group relative flex flex-col items-start rounded-lg border border-gray-200 bg-gray-50 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
              >
                <button type="button" onClick={() => setEditingTopic(topic)} className="flex w-full flex-col items-start text-left">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{topic.title}</span>
                  <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {topic.entry_count > 0 ? `${topic.entry_count} entr${topic.entry_count !== 1 ? "ies" : "y"}` : "Empty — add content"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteTopic(topic)}
                  className="absolute right-2 top-2 hidden text-xs text-red-600 hover:text-red-700 group-hover:block dark:text-red-400"
                  aria-label={`Delete ${topic.title}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "religious" && <LisanDictionaryUploader />}

      {editing && (
        <FaqBucketEditor
          departmentId={editing.department_id}
          departmentName={editing.department_name}
          initialContent={editing.content}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}

      {editingTopic && (
        <ContentBucketEditor
          title={editingTopic.title}
          subtitle="Waaz Talaqi content — keep a respectful, sourced tone. Separate entries with a blank line. Saving re-indexes this for the agent."
          placeholder={"Q: What was the theme of Majlis 1?\nA: ...\n\nQ: What does \"aaeen\" mean?\nA: ..."}
          initialContent={editingTopic.content}
          endpoint={`/api/admin/religious-topics/${editingTopic.id}`}
          showSource
          initialSourceUrl={editingTopic.source_url ?? null}
          onClose={() => setEditingTopic(null)}
          onSaved={() => void load()}
        />
      )}
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
