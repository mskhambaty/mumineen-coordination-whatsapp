"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { canAccessPortal } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import FaqBucketEditor from "@/components/admin/FaqBucketEditor";

// Logistics knowledge base: department FAQ buckets + uploaded documents the WhatsApp agent retrieves
// from. Religious / Waaz content (the Ashara grid, the Lisan dictionary, standalone Waaz blocks) is
// managed in the Waaz Talaqqi hub (/admin/religious), not here.

type Department = { id: string; name: string };

type FaqBucket = {
  department_id: string;
  department_name: string;
  content: string;
  chunk_count: number;
  entry_count: number;
  updated_at: string | null;
};

type KnowledgeDoc = {
  id: string;
  title: string;
  filename: string | null;
  file_type: string;
  status: "processing" | "indexed" | "failed";
  chunk_count: number;
  error: string | null;
  created_at: string;
  department: { name: string } | null;
  uploader: { display_name: string | null } | null;
};

const STATUS_CLASSES: Record<KnowledgeDoc["status"], string> = {
  indexed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  processing: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function KnowledgePage() {
  const router = useRouter();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [buckets, setBuckets] = useState<FaqBucket[]>([]);
  const [editing, setEditing] = useState<FaqBucket | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [docChunks, setDocChunks] = useState<Record<string, { section: string; content: string }[] | "loading" | "error">>({});
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);

  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveSyncMsg, setDriveSyncMsg] = useState<string | null>(null);

  const learnedFaqCount = documents.filter((d) => d.file_type === "faq").length;

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
      const [logRes, deptRes, bucketsRes] = await Promise.all([
        apiFetch("/api/knowledge?store=logistics"),
        apiFetch("/api/departments"),
        apiFetch("/api/admin/faq-buckets"),
      ]);
      const logData = await logRes.json().catch(() => ({}));
      if (!logRes.ok) throw new Error(logData.error ?? "Failed to load documents");
      setDocuments((logData.documents ?? []) as KnowledgeDoc[]);
      if (deptRes.ok) setDepartments((await deptRes.json()) as Department[]);
      if (bucketsRes.ok) setBuckets(((await bucketsRes.json()).buckets ?? []) as FaqBucket[]);
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
      const res = await apiFetch("/api/admin/faq-buckets", { method: "POST", body: JSON.stringify({ action: "migrate" }) });
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
      const res = await apiFetch(`/api/admin/knowledge/drive-sync?dryRun=${dryRun}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "Drive sync failed");
      const s = (data.stats ?? {}) as {
        dryRun?: boolean; scanned?: number; added?: number; updated?: number; skipped?: number; deleted?: number; errors?: unknown[]; note?: string;
      };
      if (s.note) { setDriveSyncMsg(s.note); return; }
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
    if (!departmentId) {
      setError("Please select a department for this document.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("department_id", departmentId);
      if (title.trim()) body.append("title", title.trim());
      try {
        const uid = (JSON.parse(localStorage.getItem("admin_user") ?? "null") as { id?: string } | null)?.id;
        if (uid) body.append("uploaded_by", uid);
      } catch { /* unattributed */ }

      const res = await apiFetch("/api/knowledge", { method: "POST", body });
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
      const res = await apiFetch(`/api/knowledge/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete");
      setDocuments((items) => items.filter((item) => item.id !== doc.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function toggleDocContent(doc: KnowledgeDoc) {
    if (expandedDoc === doc.id) { setExpandedDoc(null); return; }
    setExpandedDoc(doc.id);
    if (docChunks[doc.id] && docChunks[doc.id] !== "error") return;
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Knowledge Base</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Logistics FAQs and documents the WhatsApp agent retrieves from. Religious / Waaz content is
          managed in <a href="/admin/religious?tab=content" className="text-blue-600 hover:underline dark:text-blue-400">Waaz Talaqqi</a>.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <form onSubmit={upload} className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">Upload a document</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Title (optional)
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Transportation FAQ"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>
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
            disabled={!file || !departmentId || uploading}
            className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            {uploading ? "Indexing..." : "Upload & Index"}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          CSV, Excel (.xlsx/.xls), Word (.docx), or PDF, up to 15 MB. Scanned/image-only PDFs can&apos;t be read.
        </p>
      </form>

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
            <button type="button" onClick={() => void runDriveSync(true)} disabled={driveSyncing} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
              {driveSyncing ? "Working…" : "Dry run"}
            </button>
            <button type="button" onClick={() => void runDriveSync(false)} disabled={driveSyncing} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700">
              {driveSyncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </div>
        {driveSyncMsg && <p className="mt-3 text-sm font-medium text-green-700 dark:text-green-400">{driveSyncMsg}</p>}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800"><h2 className="font-semibold">Indexed documents</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-800/60">
              <tr>
                {["Title", "Type", "Department", "Status", "Chunks", "Uploaded by", "Uploaded"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{h}</th>
                ))}
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading...</td></tr>
              ) : documents.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No documents yet. Upload one above.</td></tr>
              ) : (
                documents.flatMap((doc) => {
                  const rows = [
                    <tr key={doc.id}>
                      <td className="px-5 py-4 text-sm font-medium" title={doc.error ?? undefined}>{doc.title}</td>
                      <td className="px-5 py-4 text-sm uppercase text-gray-500 dark:text-gray-400">{doc.file_type}</td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.department?.name ?? "—"}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[doc.status]}`}>{doc.status}</span>
                        {doc.status === "failed" && doc.error && <span className="mt-1 block max-w-xs text-xs text-red-600 dark:text-red-400">{doc.error}</span>}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.chunk_count}</td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.uploader?.display_name ?? (doc.file_type === "faq" ? "Learned from chat" : "—")}</td>
                      <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">{formatDate(doc.created_at)}</td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {doc.status === "indexed" && (
                            <button type="button" onClick={() => void toggleDocContent(doc)} className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
                              {expandedDoc === doc.id ? "Hide" : "View"}
                            </button>
                          )}
                          <button type="button" onClick={() => void remove(doc)} className="text-sm text-red-600 hover:text-red-700 dark:text-red-400">Delete</button>
                        </div>
                      </td>
                    </tr>,
                  ];
                  if (expandedDoc === doc.id) {
                    const content = docChunks[doc.id];
                    rows.push(
                      <tr key={`${doc.id}-content`} className="bg-gray-50 dark:bg-gray-800/40">
                        <td colSpan={8} className="px-5 py-4">
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
              <button type="button" onClick={() => void migrateLearned()} disabled={migrating} className="rounded-md border border-blue-500 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20">
                {migrating ? "Sorting…" : `Sort ${learnedFaqCount} learned FAQ(s) into departments`}
              </button>
            </div>
          )}
        </div>
        {migrateMsg && <p className="mt-2 text-sm font-medium text-green-700 dark:text-green-400">{migrateMsg}</p>}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {buckets.map((bucket) => (
            <button key={bucket.department_id} type="button" onClick={() => setEditing(bucket)} className="flex flex-col items-start rounded-lg border border-gray-200 bg-gray-50 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-blue-500 dark:hover:bg-blue-900/20">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{bucket.department_name}</span>
              <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {bucket.entry_count > 0 ? `${bucket.entry_count} FAQ${bucket.entry_count !== 1 ? "s" : ""}` : "Empty — add FAQs"}
              </span>
            </button>
          ))}
        </div>
      </section>

      {editing && (
        <FaqBucketEditor
          departmentId={editing.department_id}
          departmentName={editing.department_name}
          initialContent={editing.content}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
