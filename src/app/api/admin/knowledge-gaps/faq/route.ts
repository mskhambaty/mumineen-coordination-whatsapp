import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { chunkText, indexKnowledgeChunks } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Embedding a short FAQ is quick, but give headroom.
export const maxDuration = 60;

// POST /api/admin/knowledge-gaps/faq — create a quick FAQ from a knowledge gap and vectorize it
// into the logistics store so the agent can answer it next time. Optionally marks the gap
// addressed. Mirrors the document upload flow but takes typed text instead of a file.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    gap_id?: unknown;
    title?: unknown;
    question?: unknown;
    answer?: unknown;
  };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  const gapId = typeof body.gap_id === "string" ? body.gap_id : null;

  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 });
  if (!answer) return NextResponse.json({ error: "An answer is required." }, { status: 400 });

  const supabase = getSupabaseAdmin();

  const { data: doc, error: insertError } = await supabase
    .from("knowledge_documents")
    .insert({
      department_id: null,
      title,
      filename: `${title}.faq`,
      file_type: "faq",
      store: "logistics",
      status: "processing",
      uploaded_by: null,
    })
    .select("id")
    .single();

  if (insertError || !doc) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create FAQ" }, { status: 500 });
  }

  try {
    // Include the example question so future, similarly-phrased queries match this FAQ.
    const content = question ? `${title}\n\nQ: ${question}\n\nA: ${answer}` : `${title}\n\n${answer}`;
    const chunks = chunkText(content);
    const chunkCount = await indexKnowledgeChunks(doc.id, title, chunks);
    await supabase.from("knowledge_documents").update({ status: "indexed", chunk_count: chunkCount }).eq("id", doc.id);

    if (gapId) {
      await supabase
        .from("knowledge_gaps")
        .update({ status: "addressed", updated_at: new Date().toISOString() })
        .eq("id", gapId);
    }

    return NextResponse.json({ id: doc.id, title, chunk_count: chunkCount, status: "indexed" }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to index FAQ";
    await supabase.from("knowledge_documents").update({ status: "failed", error: message.slice(0, 300) }).eq("id", doc.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
