import { AI_EMBEDDING_MODEL, getAIClient } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Every indexed chunk is about this one event. Terse user questions (e.g. just
// "accommodation") embed too far from the event-specific chunks to clear the
// similarity floor — but the same chunks match once the query carries event
// context. So anchor every query to the event domain before embedding, which
// makes one-word questions retrieve as well as fully-phrased ones.
const EVENT_CONTEXT = "Ashara Mubaraka 1448H, Chicago Relay Center — visitor information for mumineen:";

// text-embedding-3-small similarities run lower in absolute terms than larger
// models, so keep the floor modest. Too high (e.g. 0.55) drops valid matches.
const MATCH_THRESHOLD = 0.42;

export async function retrieveSiteContext(query: string, topK = 5): Promise<string> {
  const openai = getAIClient();
  const supabase = getSupabaseAdmin();

  const embeddingRes = await openai.embeddings.create({
    model: AI_EMBEDDING_MODEL,
    input: `${EVENT_CONTEXT} ${query}`,
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  const { data, error } = await supabase.rpc("match_site_content", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: MATCH_THRESHOLD,
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
