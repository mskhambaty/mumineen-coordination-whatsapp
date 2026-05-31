import { AI_EMBEDDING_MODEL, getAIClient } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const MAX_CHUNK_CHARS = 1500;
const EMBED_BATCH = 100;

// Uploaded knowledge chunks live in site_content tagged with this page_url so the
// agent's get_site_content_faq finds them and we can delete/replace per document.
export function knowledgePageUrl(docId: string): string {
  return `knowledge://${docId}`;
}

// Split extracted text into embedding-sized chunks, preferring paragraph breaks.
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of clean.split(/\n{2,}/)) {
    const para = paragraph.trim();
    if (!para) continue;

    if (para.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars));
      }
      continue;
    }

    if (current && (current.length + 2 + para.length) > maxChars) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

// Embed chunks and insert them into site_content for this document.
export async function indexKnowledgeChunks(docId: string, title: string, chunks: string[]): Promise<number> {
  if (chunks.length === 0) return 0;

  const openai = getAIClient();
  const supabase = getSupabaseAdmin();

  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const res = await openai.embeddings.create({ model: AI_EMBEDDING_MODEL, input: batch });
    for (const item of res.data) embeddings.push(item.embedding);
  }

  const rows = chunks.map((content, i) => ({
    page_url: knowledgePageUrl(docId),
    page_title: title,
    section: `chunk_${i + 1}`,
    content,
    embedding: JSON.stringify(embeddings[i]),
    scraped_at: new Date().toISOString(),
    is_current: true,
  }));

  const { error } = await supabase.from("site_content").insert(rows);
  if (error) throw error;
  return rows.length;
}

// Remove a document's vectorized chunks from site_content.
export async function deleteKnowledgeChunks(docId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("site_content")
    .delete()
    .eq("page_url", knowledgePageUrl(docId));
  if (error) throw error;
}
