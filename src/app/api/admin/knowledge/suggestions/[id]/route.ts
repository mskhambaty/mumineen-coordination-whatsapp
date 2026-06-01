import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { chunkText, indexKnowledgeChunks } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ActionBody = {
  action?: unknown;
  question?: unknown;
  answer?: unknown;
  reviewed_by?: unknown;
};

// POST: approve (index into the knowledge base) or reject a suggestion.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as ActionBody;
  const action = body.action === "approve" || body.action === "reject" ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const reviewedBy = typeof body.reviewed_by === "string" ? body.reviewed_by.slice(0, 200) : null;
  const supabase = getSupabaseAdmin();

  const { data: suggestion, error: lookupError } = await supabase
    .from("knowledge_suggestions")
    .select("id, question, suggested_answer, status")
    .eq("id", id)
    .maybeSingle();

  if (lookupError || !suggestion) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }
  if (suggestion.status !== "pending") {
    return NextResponse.json({ error: "Suggestion has already been reviewed" }, { status: 409 });
  }

  if (action === "reject") {
    await supabase
      .from("knowledge_suggestions")
      .update({ status: "rejected", reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ id, status: "rejected" });
  }

  // Approve: index the (possibly edited) Q&A into the knowledge base.
  const question = (typeof body.question === "string" ? body.question : suggestion.question).trim();
  const answer = (typeof body.answer === "string" ? body.answer : suggestion.suggested_answer).trim();
  if (!question || !answer) {
    return NextResponse.json({ error: "Question and answer are required to approve" }, { status: 400 });
  }

  const title = question.length > 120 ? `${question.slice(0, 117)}...` : question;
  const content = `Q: ${question}\n\nA: ${answer}`;

  const { data: doc, error: docError } = await supabase
    .from("knowledge_documents")
    .insert({
      title,
      filename: "Learned from conversations",
      file_type: "faq",
      status: "processing",
    })
    .select("id")
    .single();

  if (docError || !doc) {
    return NextResponse.json({ error: docError?.message ?? "Failed to create knowledge entry" }, { status: 500 });
  }

  try {
    const chunkCount = await indexKnowledgeChunks(doc.id, title, chunkText(content));
    await supabase.from("knowledge_documents").update({ status: "indexed", chunk_count: chunkCount }).eq("id", doc.id);

    await supabase
      .from("knowledge_suggestions")
      .update({
        status: "approved",
        knowledge_document_id: doc.id,
        question,
        suggested_answer: answer,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ id, status: "approved", knowledge_document_id: doc.id, chunk_count: chunkCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to index entry";
    await supabase.from("knowledge_documents").update({ status: "failed", error: message.slice(0, 300) }).eq("id", doc.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
