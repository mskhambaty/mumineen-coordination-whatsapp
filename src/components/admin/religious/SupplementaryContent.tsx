"use client";

import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/admin/client";
import ContentBucketEditor from "@/components/admin/ContentBucketEditor";

// Zone B of the Content tab: supplementary religious material that isn't the structured majlis grid —
// free-form document upload (vector-indexed into the religious store) and the standalone Waaz
// FAQ-by-Topic blocks. Moved out of /admin/knowledge so the hub owns all religious content. Hardcoded
// to the religious store; reuses the same APIs the Knowledge page used.

type KnowledgeDoc = {
  id: string;
  title: string;
  file_type: string;
  status: "processing" | "indexed" | "failed";
  chunk_count: number;
  error: string | null;
  created_at: string;
  uploader: { display_name: string | null } | null;
};

type ReligiousTopic = {
  id: string;
  title: string;
  content: string;
  entry_count: number;
  source_url: string | null;
  category: string | null;
  majlis_number: number | null;
  is_ashura: boolean;
};

// Per-majlis Ashara blocks are managed in the grid above; keep this list to the standalone helpers.
const MAJLIS_CATEGORIES = new Set(["reflection", "tazyeen", "al_dars", "jumla", "kalema", "unwaan"]);
const isMajlisBlock = (t: ReligiousTopic) => !!t.category && MAJLIS_CATEGORIES.has(t.category) && (t.majlis_number != null || t.is_ashura);

const STATUS_CLASSES: Record<KnowledgeDoc["status"], string> = {
  indexed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  processing: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function fmtDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function SupplementaryContent() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [topics, setTopics] = useState<ReligiousTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [docChunks, setDocChunks] = useState<Record<string, { section: string; content: string }[] | "loading" | "error">>({});

  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);
  const [editingTopic, setEditingTopic] = useState<ReligiousTopic | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [docsRes, topicsRes] = await Promise.all([
        apiFetch("/api/knowledge?store=religious"),
        apiFetch("/api/admin/religious-topics"),
      ]);
      if (docsRes.ok) setDocs(((await docsRes.json()).documents ?? []) as KnowledgeDoc[]);
      if (topicsRes.ok) setTopics(((await topicsRes.json()).topics ?? []) as ReligiousTopic[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
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
      body.append("store", "religious");
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

  async function removeDoc(doc: KnowledgeDoc) {
    if (!window.confirm(`Delete "${doc.title}"? Its content will be removed from the AI's knowledge.`)) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/knowledge/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete");
      setDocs((items) => items.filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function toggleDoc(doc: KnowledgeDoc) {
    if (expandedDoc === doc.id) { setExpandedDoc(null); return; }
    setExpandedDoc(doc.id);
    if (docChunks[doc.id] && docChunks[doc.id] !== "error") return;
    setDocChunks((p) => ({ ...p, [doc.id]: "loading" }));
    try {
      const res = await apiFetch(`/api/knowledge/${doc.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setDocChunks((p) => ({ ...p, [doc.id]: (data.chunks ?? []) as { section: string; content: string }[] }));
    } catch {
      setDocChunks((p) => ({ ...p, [doc.id]: "error" }));
    }
  }

  async function addTopic() {
    const titleText = newTopicTitle.trim();
    if (!titleText) return;
    setAddingTopic(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/religious-topics", { method: "POST", body: JSON.stringify({ title: titleText }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to add topic");
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
      const res = await apiFetch(`/api/admin/religious-topics/${topic.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete topic");
      setTopics((items) => items.filter((t) => t.id !== topic.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete topic");
    }
  }

  const standalone = topics.filter((t) => !isMajlisBlock(t));

  return (
    <div className="space-y-5 border-t border-gray-200 pt-5 dark:border-gray-800">
      <div>
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Supplementary content</h2>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Free-form documents and standalone Waaz FAQ blocks — separate from the per-majlis grid above.</p>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}

      {/* Upload */}
      <form onSubmit={upload} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="font-semibold">Upload Waaz Talaqi content</h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional) — e.g. Reflections — Majlis 1" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 sm:max-w-xs" />
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.docx,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 dark:text-gray-300" />
          <button type="submit" disabled={!file || uploading} className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700">{uploading ? "Indexing…" : "Upload & Index"}</button>
        </div>
      </form>

      {/* Indexed documents */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800"><h3 className="font-semibold">Indexed documents</h3></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-800/60">
              <tr>
                {["Title", "Type", "Status", "Chunks", "Uploaded by", "Uploaded"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{h}</th>
                ))}
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No documents yet. Upload one above.</td></tr>
              ) : (
                docs.flatMap((doc) => {
                  const rows = [
                    <tr key={doc.id}>
                      <td className="px-5 py-4 text-sm font-medium" title={doc.error ?? undefined}>{doc.title}</td>
                      <td className="px-5 py-4 text-sm uppercase text-gray-500 dark:text-gray-400">{doc.file_type}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[doc.status]}`}>{doc.status}</span>
                        {doc.status === "failed" && doc.error && <span className="mt-1 block max-w-xs text-xs text-red-600 dark:text-red-400">{doc.error}</span>}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.chunk_count}</td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{doc.uploader?.display_name ?? "—"}</td>
                      <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">{fmtDate(doc.created_at)}</td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {doc.status === "indexed" && <button type="button" onClick={() => void toggleDoc(doc)} className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">{expandedDoc === doc.id ? "Hide" : "View"}</button>}
                          <button type="button" onClick={() => void removeDoc(doc)} className="text-sm text-red-600 hover:text-red-700 dark:text-red-400">Delete</button>
                        </div>
                      </td>
                    </tr>,
                  ];
                  if (expandedDoc === doc.id) {
                    const content = docChunks[doc.id];
                    rows.push(
                      <tr key={`${doc.id}-content`} className="bg-gray-50 dark:bg-gray-800/40">
                        <td colSpan={7} className="px-5 py-4">
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

      {/* FAQ by Topic (standalone) */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">FAQ by Topic</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">Standalone editable blocks (Vaaz Talaqi help, Lisan meanings, guardrails). Click a topic to edit; saving re-indexes it.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input value={newTopicTitle} onChange={(e) => setNewTopicTitle(e.target.value)} placeholder="New topic title…" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <button type="button" onClick={() => void addTopic()} disabled={!newTopicTitle.trim() || addingTopic} className="rounded-md border border-blue-500 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20">{addingTopic ? "Adding…" : "Add topic"}</button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {standalone.map((topic) => (
            <div key={topic.id} className="group relative flex flex-col items-start rounded-lg border border-gray-200 bg-gray-50 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-blue-500 dark:hover:bg-blue-900/20">
              <button type="button" onClick={() => setEditingTopic(topic)} className="flex w-full flex-col items-start text-left">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{topic.title}</span>
                <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">{topic.entry_count > 0 ? `${topic.entry_count} entr${topic.entry_count !== 1 ? "ies" : "y"}` : "Empty — add content"}</span>
              </button>
              <button type="button" onClick={() => void deleteTopic(topic)} className="absolute right-2 top-2 hidden text-xs text-red-600 hover:text-red-700 group-hover:block dark:text-red-400" aria-label={`Delete ${topic.title}`}>✕</button>
            </div>
          ))}
          {standalone.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No standalone topics yet.</p>}
        </div>
      </section>

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
    </div>
  );
}
