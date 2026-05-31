import { AI_EMBEDDING_MODEL, getAIClient } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function retrieveSiteContext(query: string, topK = 3): Promise<string> {
  const openai = getAIClient();
  const supabase = getSupabaseAdmin();

  const embeddingRes = await openai.embeddings.create({
    model: AI_EMBEDDING_MODEL,
    input: query,
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  const { data, error } = await supabase.rpc("match_site_content", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: 0.55,
    match_count: topK,
  });

  if (error) {
    console.error("Site context retrieval failed:", error);
    return "";
  }

  if (!data?.length) return "";

  return data
    .map((row: { page_title: string; page_url?: string; content: string }) => {
      const source = row.page_url ? `\nSource: ${row.page_url}` : "";
      return `[${row.page_title}]${source}\n${row.content}`;
    })
    .join("\n\n---\n\n");
}
