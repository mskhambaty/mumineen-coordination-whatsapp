import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { chunkText, indexKnowledgeChunks, indexReligiousDocument } from "@/lib/knowledge/index-content";
import { detectFileType, extractText } from "@/lib/knowledge/parse";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Parsing + embedding a large doc can take a while.
export const maxDuration = 120;

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

// GET: list uploaded knowledge documents (newest first).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;

  // Optional ?store=logistics|religious filter (defaults to all for backward compatibility).
  const store = req.nextUrl.searchParams.get("store");

  let query = getSupabaseAdmin()
    .from("knowledge_documents")
    .select(
      "id, title, filename, file_type, store, status, chunk_count, error, created_at, department:departments(name), uploader:whatsapp_users!knowledge_documents_uploaded_by_fkey(display_name)",
    )
    .order("created_at", { ascending: false });

  if (store === "logistics" || store === "religious") {
    query = query.eq("store", store);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ documents: data ?? [] });
}

// POST: upload a CSV/Excel/Word/PDF file; extract text, chunk, embed into site_content.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large (max 15 MB)" }, { status: 400 });
  }

  const type = detectFileType(file.name, file.type);
  if (!type) {
    return NextResponse.json({ error: "Unsupported file type. Use CSV, Excel, Word, or PDF." }, { status: 400 });
  }

  const storeRaw = form?.get("store");
  const store = storeRaw === "religious" ? "religious" : "logistics";
  // Religious uploads are not department-scoped.
  const departmentIdRaw = form?.get("department_id");
  const departmentId =
    store === "religious" ? null : typeof departmentIdRaw === "string" && departmentIdRaw ? departmentIdRaw : null;
  const titleRaw = form?.get("title");
  const title = (typeof titleRaw === "string" && titleRaw.trim()) || file.name;
  const uploadedByRaw = form?.get("uploaded_by");
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uploadedBy = typeof uploadedByRaw === "string" && UUID_RE.test(uploadedByRaw) ? uploadedByRaw : null;

  const supabase = getSupabaseAdmin();
  const { data: doc, error: insertError } = await supabase
    .from("knowledge_documents")
    .insert({ department_id: departmentId, title, filename: file.name, file_type: type, store, status: "processing", uploaded_by: uploadedBy })
    .select("id")
    .single();

  if (insertError || !doc) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create document" }, { status: 500 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractText(buffer, type);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      const message = "No extractable text found — scanned/image PDFs and empty files aren't supported.";
      await supabase.from("knowledge_documents").update({ status: "failed", error: message }).eq("id", doc.id);
      return NextResponse.json({ error: message }, { status: 422 });
    }

    const chunkCount =
      store === "religious"
        ? await indexReligiousDocument(doc.id, title, chunks)
        : await indexKnowledgeChunks(doc.id, title, chunks);
    await supabase.from("knowledge_documents").update({ status: "indexed", chunk_count: chunkCount }).eq("id", doc.id);

    return NextResponse.json({ id: doc.id, title, file_type: type, store, status: "indexed", chunk_count: chunkCount }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process file";
    await supabase.from("knowledge_documents").update({ status: "failed", error: message.slice(0, 300) }).eq("id", doc.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
