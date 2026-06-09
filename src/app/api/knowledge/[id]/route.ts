import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { deleteKnowledgeChunks, deleteReligiousContent, knowledgePageUrl, religiousPageUrl } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// GET: return a document's indexed chunk content so admins can review what was actually
// embedded (and judge whether it's still relevant) without re-uploading. Logistics docs live
// in site_content (knowledge://<id>); religious uploads in religious_content (religious://doc/<id>).
export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: doc, error: docError } = await supabase
    .from("knowledge_documents")
    .select("id, title, store, status, chunk_count")
    .eq("id", id)
    .maybeSingle();

  if (docError) return NextResponse.json({ error: docError.message }, { status: 500 });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const isReligious = doc.store === "religious";
  const table = isReligious ? "religious_content" : "site_content";
  const pageUrl = isReligious ? religiousPageUrl("doc", id) : knowledgePageUrl(id);

  const { data: rows, error: chunkError } = await supabase
    .from(table)
    .select("section, content")
    .eq("page_url", pageUrl)
    .order("section", { ascending: true });

  if (chunkError) return NextResponse.json({ error: chunkError.message }, { status: 500 });

  // Sort by the trailing chunk number ("chunk_2" < "chunk_10") rather than lexically.
  const chunks = (rows ?? [])
    .map((r) => ({ section: r.section as string, content: r.content as string }))
    .sort((a, b) => {
      const na = Number(a.section?.replace(/\D/g, "")) || 0;
      const nb = Number(b.section?.replace(/\D/g, "")) || 0;
      return na - nb;
    });

  return NextResponse.json({ id: doc.id, title: doc.title, store: doc.store, status: doc.status, chunks });
}

// DELETE: remove a document and its vectorized chunks from the store it was indexed into
// (site_content for logistics, religious_content for religious uploads).
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: doc } = await supabase.from("knowledge_documents").select("store").eq("id", id).maybeSingle();

  try {
    if (doc?.store === "religious") {
      await deleteReligiousContent("doc", id);
    } else {
      await deleteKnowledgeChunks(id);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const { error } = await supabase.from("knowledge_documents").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
