import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { deleteKnowledgeChunks, deleteReligiousContent } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

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
