import { getOpenAIClient } from "@/lib/agent/run-agent";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function retrieveSiteContext(query: string, topK = 3): Promise<string> {
  const openai = getOpenAIClient();
  const supabase = getSupabaseAdmin();

  const embeddingRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  const { data, error } = await supabase.rpc("match_site_content", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: 0.75,
    match_count: topK,
  });

  if (error) {
    console.error("Site context retrieval failed:", error);
    return "";
  }

  if (!data?.length) return "";

  return data
    .map((row: { page_title: string; content: string }) => `[${row.page_title}]\n${row.content}`)
    .join("\n\n---\n\n");
}
