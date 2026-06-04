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

// FAQ bucket chunks live in site_content under this page_url so they're retrievable
// like any other knowledge, and replaceable per department.
export function faqBucketPageUrl(departmentId: string): string {
  return `faqbucket://${departmentId}`;
}

// Embed chunks in batches, preserving order.
async function embedChunks(chunks: string[]): Promise<number[][]> {
  const openai = getAIClient();
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const res = await openai.embeddings.create({ model: AI_EMBEDDING_MODEL, input: batch });
    for (const item of res.data) embeddings.push(item.embedding);
  }
  return embeddings;
}

// Embed chunks and (re)insert them into site_content under a given page_url + title.
// Any existing chunks for that page_url are removed first, so this fully replaces them.
export async function indexChunksForPage(pageUrl: string, title: string, chunks: string[]): Promise<number> {
  const supabase = getSupabaseAdmin();
  await supabase.from("site_content").delete().eq("page_url", pageUrl);

  if (chunks.length === 0) return 0;

  const embeddings = await embedChunks(chunks);

  const rows = chunks.map((content, i) => ({
    page_url: pageUrl,
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

// --- Religious content (Issue #43) ---
// Religious content lives in its OWN table (religious_content) so the
// answer_religious_questions tool never cross-contaminates with logistics retrieval.
// Namespaces: religious://topic/<id> for editable topic blocks, religious://doc/<id> for uploads.
export function religiousPageUrl(kind: "topic" | "doc", id: string): string {
  return `religious://${kind}/${id}`;
}

// Embed chunks and (re)insert them into religious_content under a page_url. Replaces any
// existing chunks for that page_url first.
async function indexReligiousChunks(
  pageUrl: string,
  title: string,
  chunks: string[],
  sourceType: "topic_block" | "uploaded_doc",
): Promise<number> {
  const supabase = getSupabaseAdmin();
  await supabase.from("religious_content").delete().eq("page_url", pageUrl);

  if (chunks.length === 0) return 0;

  const embeddings = await embedChunks(chunks);

  const rows = chunks.map((content, i) => ({
    page_url: pageUrl,
    page_title: title,
    section: `chunk_${i + 1}`,
    content,
    embedding: JSON.stringify(embeddings[i]),
    source_type: sourceType,
    indexed_at: new Date().toISOString(),
    is_current: true,
  }));

  const { error } = await supabase.from("religious_content").insert(rows);
  if (error) throw error;
  return rows.length;
}

// Re-index a religious topic block: replaces its chunks with the current content.
export async function indexReligiousTopic(topicId: string, title: string, content: string): Promise<number> {
  return indexReligiousChunks(religiousPageUrl("topic", topicId), title, chunkText(content), "topic_block");
}

// Embed an uploaded religious document's chunks into religious_content.
export async function indexReligiousDocument(docId: string, title: string, chunks: string[]): Promise<number> {
  return indexReligiousChunks(religiousPageUrl("doc", docId), title, chunks, "uploaded_doc");
}

// Remove a religious topic's or document's vectorized chunks from religious_content.
export async function deleteReligiousContent(kind: "topic" | "doc", id: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("religious_content")
    .delete()
    .eq("page_url", religiousPageUrl(kind, id));
  if (error) throw error;
}

// Embed chunks and insert them into site_content for an uploaded document.
export async function indexKnowledgeChunks(docId: string, title: string, chunks: string[]): Promise<number> {
  return indexChunksForPage(knowledgePageUrl(docId), title, chunks);
}

// Re-index a department's FAQ bucket: replaces its chunks with the current content.
export async function indexFaqBucket(departmentId: string, departmentName: string, content: string): Promise<number> {
  return indexChunksForPage(faqBucketPageUrl(departmentId), `${departmentName} FAQ`, chunkText(content));
}

// Remove a document's vectorized chunks from site_content.
export async function deleteKnowledgeChunks(docId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("site_content")
    .delete()
    .eq("page_url", knowledgePageUrl(docId));
  if (error) throw error;
}
