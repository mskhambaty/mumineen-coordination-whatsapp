"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { canManageKnowledge } from "@/lib/admin/access";

type Department = { id: string; name: string };

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

  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const userRaw = localStorage.getItem("admin_user");
    const user = userRaw ? JSON.parse(userRaw) as { role?: string; global_role?: string; is_manager?: boolean } : null;
    if (!canManageKnowledge(user)) {
      router.push("/admin/conversations");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [docsRes, deptRes] = await Promise.all([
        fetch("/api/knowledge", { headers: { "x-admin-key": adminKey } }),
        fetch("/api/departments", { headers: { "x-admin-key": adminKey } }),
      ]);
      const docsData = await docsRes.json().catch(() => ({}));
      if (!docsRes.ok) throw new Error(docsData.error ?? "Failed to load documents");
      setDocuments((docsData.documents ?? []) as KnowledgeDoc[]);
      if (deptRes.ok) setDepartments((await deptRes.json()) as Department[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      if (departmentId) body.append("department_id", departmentId);
      if (title.trim()) body.append("title", title.trim());

      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "x-admin-key": adminKey },
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
      const res = await fetch(`/api/knowledge/${doc.id}`, {
        method: "DELETE",
        headers: { "x-admin-key": adminKey },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete");
      }
      setDocuments((items) => items.filter((item) => item.id !== doc.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold">FAQ &amp; Guides</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Upload customer-facing facts, FAQs, and guides (CSV, Excel, Word, PDF). Their text is indexed into the
          assistant&apos;s knowledge, so the WhatsApp agent can answer from them.
        </p>
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
            Department (optional)
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">No department</option>
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
            disabled={!file || uploading}
            className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            {uploading ? "Indexing..." : "Upload & Index"}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          CSV, Excel (.xlsx/.xls), Word (.docx), or PDF, up to 15 MB. Scanned/image-only PDFs can&apos;t be read.
        </p>
      </form>

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
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Department</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Chunks</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Uploaded</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading...</td></tr>
              ) : documents.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No documents yet. Upload one above.</td></tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-5 py-4 text-sm font-medium" title={doc.error ?? undefined}>{doc.title}</td>
                    <td className="px-5 py-4 text-sm uppercase text-gray-500 dark:text-gray-400">{doc.file_type}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.department?.name ?? "—"}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[doc.status]}`}>{doc.status}</span>
                      {doc.status === "failed" && doc.error && (
                        <span className="mt-1 block max-w-xs text-xs text-red-600 dark:text-red-400">{doc.error}</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.chunk_count}</td>
                    <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">{formatDate(doc.created_at)}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => void remove(doc)}
                        className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
