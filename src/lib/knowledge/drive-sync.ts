import crypto from "node:crypto";

import { optionalEnv, requireEnv } from "@/lib/env";
import {
  chunkText,
  deleteKnowledgeChunks,
  indexKnowledgeChunks,
} from "@/lib/knowledge/index-content";
import { extractText, type KnowledgeFileType } from "@/lib/knowledge/parse";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Drive → knowledge-base sync (#89).
 *
 * Pulls FAQ documents from the shared Google Drive "WhatsApp" FAQ folder and
 * indexes them into the knowledge base, so teams that hydrate a doc on Drive no
 * longer depend on a manual portal upload. Each Drive file maps 1:1 to a
 * knowledge_documents row (source='drive_sync', keyed by drive_file_id):
 *   - new file        -> insert + index
 *   - changed file    -> re-index (modifiedTime changed)
 *   - unchanged file  -> skip
 *   - removed file    -> left in place by default; deleted only if
 *                        GDRIVE_SYNC_DELETE_REMOVED=true (opt-in)
 *
 * Auth uses a Google service account (env GOOGLE_SERVICE_ACCOUNT_JSON) with
 * read-only Drive scope; the FAQ folder must be shared with the service
 * account's email. Folder id comes from GDRIVE_FAQ_FOLDER_ID.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

// Google-native exports -> a format extractText() understands.
const GOOGLE_EXPORT: Record<string, { exportMime: string; type: KnowledgeFileType }> = {
  "application/vnd.google-apps.document": {
    exportMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    type: "word",
  },
  "application/vnd.google-apps.spreadsheet": {
    exportMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    type: "excel",
  },
};

// Already-binary file types we can download directly (alt=media).
export function binaryType(mimeType: string, name: string): KnowledgeFileType | null {
  const m = mimeType.toLowerCase();
  const lower = name.toLowerCase();
  if (m === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (m.includes("wordprocessingml") || m.includes("msword") || lower.endsWith(".docx")) return "word";
  if (m.includes("spreadsheetml") || m.includes("ms-excel") || lower.endsWith(".xlsx") || lower.endsWith(".xls"))
    return "excel";
  if (m === "text/csv" || lower.endsWith(".csv")) return "csv";
  return null;
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  parentName: string | null;
};

export type DriveSyncAction = "add" | "update" | "skip" | "delete";

export type DriveSyncStats = {
  dryRun: boolean;
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  deleted: number;
  errors: Array<{ file: string; error: string }>;
  // Per-file planned/performed action — useful for dry-run previews.
  plan: Array<{ file: string; action: DriveSyncAction }>;
};

// ---------------------------------------------------------------------------
// Service-account auth (RS256 JWT -> access token), cached until expiry.
// ---------------------------------------------------------------------------
let cachedToken: { token: string; expiresAt: number } | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function serviceAccount(): { client_email: string; private_key: string } {
  const raw = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key");
  }
  // Tolerate keys pasted with escaped newlines.
  return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  const { client_email, private_key } = serviceAccount();
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: client_email,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signature = b64url(crypto.createSign("RSA-SHA256").update(signingInput).sign(private_key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google token exchange returned no access_token");
  cachedToken = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
  return json.access_token;
}

async function driveFetch(path: string): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Listing (recursive) and downloading.
// ---------------------------------------------------------------------------
async function listChildren(folderId: string): Promise<Array<Omit<DriveFile, "parentName">>> {
  const out: Array<Omit<DriveFile, "parentName">> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await driveFetch(`files?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Drive list failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<Omit<DriveFile, "parentName">>;
    };
    out.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

// Walk the folder tree; record each non-folder file with its immediate parent name.
async function listFolderRecursive(folderId: string, parentName: string | null): Promise<DriveFile[]> {
  const children = await listChildren(folderId);
  const files: DriveFile[] = [];
  for (const c of children) {
    if (c.mimeType === DRIVE_FOLDER_MIME) {
      files.push(...(await listFolderRecursive(c.id, c.name)));
    } else {
      files.push({ ...c, parentName });
    }
  }
  return files;
}

export function resolveType(file: Pick<DriveFile, "mimeType" | "name">): {
  type: KnowledgeFileType;
  exportMime?: string;
} | null {
  const native = GOOGLE_EXPORT[file.mimeType];
  if (native) return { type: native.type, exportMime: native.exportMime };
  const bin = binaryType(file.mimeType, file.name);
  return bin ? { type: bin } : null;
}

async function download(file: DriveFile, exportMime?: string): Promise<Buffer> {
  const res = exportMime
    ? await driveFetch(`files/${file.id}/export?mimeType=${encodeURIComponent(exportMime)}`)
    : await driveFetch(`files/${file.id}?alt=media&supportsAllDrives=true`);
  if (!res.ok) {
    throw new Error(`Drive download failed for "${file.name}" (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

export function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return !Number.isNaN(ta) && !Number.isNaN(tb) && ta === tb;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
export async function syncDriveFaqFolder(options: { dryRun?: boolean } = {}): Promise<DriveSyncStats> {
  const dryRun = options.dryRun ?? false;
  const folderId = requireEnv("GDRIVE_FAQ_FOLDER_ID");
  // Default OFF for safety: removed Drive files are left in place unless deletion
  // is explicitly opted into with GDRIVE_SYNC_DELETE_REMOVED=true.
  const deleteRemoved = optionalEnv("GDRIVE_SYNC_DELETE_REMOVED") === "true";
  const supabase = getSupabaseAdmin();

  // Map subfolder name -> department id (best-effort department scoping).
  const { data: depts } = await supabase.from("departments").select("id, name");
  const deptByName = new Map<string, string>();
  for (const d of (depts ?? []) as Array<{ id: string; name: string }>) {
    deptByName.set(d.name.trim().toLowerCase(), d.id);
  }

  // Existing drive-sourced docs, keyed by Drive file id.
  const { data: existingRows } = await supabase
    .from("knowledge_documents")
    .select("id, drive_file_id, drive_modified_time, status")
    .eq("source", "drive_sync");
  const existing = new Map<string, { id: string; drive_modified_time: string | null; status: string }>();
  for (const r of (existingRows ?? []) as Array<{
    id: string;
    drive_file_id: string | null;
    drive_modified_time: string | null;
    status: string;
  }>) {
    if (r.drive_file_id) existing.set(r.drive_file_id, r);
  }

  const stats: DriveSyncStats = {
    dryRun,
    scanned: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    errors: [],
    plan: [],
  };

  const files = await listFolderRecursive(folderId, null);
  const seen = new Set<string>();

  for (const file of files) {
    const resolved = resolveType(file);
    if (!resolved) continue; // unsupported (slides, images, etc.) — silently skip
    stats.scanned++;
    seen.add(file.id);

    const prior = existing.get(file.id);
    if (prior && prior.status === "indexed" && sameInstant(prior.drive_modified_time, file.modifiedTime)) {
      stats.skipped++;
      stats.plan.push({ file: file.name, action: "skip" });
      continue;
    }

    const action: DriveSyncAction = prior ? "update" : "add";
    stats.plan.push({ file: file.name, action });

    // Dry-run: classify only — no download, no embedding, no DB writes.
    if (dryRun) {
      if (action === "add") stats.added++;
      else stats.updated++;
      continue;
    }

    try {
      const buffer = await download(file, resolved.exportMime);
      const text = await extractText(buffer, resolved.type);
      const chunks = chunkText(text);
      const title = stripExtension(file.name);
      const departmentId = file.parentName ? deptByName.get(file.parentName.trim().toLowerCase()) ?? null : null;

      if (prior) {
        await deleteKnowledgeChunks(prior.id);
        await supabase
          .from("knowledge_documents")
          .update({ status: "processing", title, file_type: resolved.type, department_id: departmentId })
          .eq("id", prior.id);
        const count = await indexKnowledgeChunks(prior.id, title, chunks);
        await supabase
          .from("knowledge_documents")
          .update({ status: "indexed", chunk_count: count, drive_modified_time: file.modifiedTime, error: null })
          .eq("id", prior.id);
        stats.updated++;
      } else {
        const { data: doc, error: insertError } = await supabase
          .from("knowledge_documents")
          .insert({
            department_id: departmentId,
            title,
            filename: file.name,
            file_type: resolved.type,
            store: "logistics",
            source: "drive_sync",
            drive_file_id: file.id,
            drive_modified_time: file.modifiedTime,
            status: "processing",
          })
          .select("id")
          .single();
        if (insertError || !doc) throw new Error(insertError?.message ?? "insert failed");
        const count = await indexKnowledgeChunks(doc.id, title, chunks);
        await supabase
          .from("knowledge_documents")
          .update({ status: "indexed", chunk_count: count, error: null })
          .eq("id", doc.id);
        stats.added++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.errors.push({ file: file.name, error: message.slice(0, 300) });
      if (prior) {
        await supabase
          .from("knowledge_documents")
          .update({ status: "failed", error: message.slice(0, 300) })
          .eq("id", prior.id);
      }
    }
  }

  // Files that vanished from the folder: remove their chunks + row.
  if (deleteRemoved) {
    for (const [driveId, row] of existing) {
      if (seen.has(driveId)) continue;
      stats.plan.push({ file: `(removed ${driveId})`, action: "delete" });
      if (dryRun) {
        stats.deleted++;
        continue;
      }
      try {
        await deleteKnowledgeChunks(row.id);
        await supabase.from("knowledge_documents").delete().eq("id", row.id);
        stats.deleted++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stats.errors.push({ file: `(removed ${driveId})`, error: message.slice(0, 300) });
      }
    }
  }

  return stats;
}
