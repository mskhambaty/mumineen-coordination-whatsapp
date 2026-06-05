import { AI_EMBEDDING_MODEL, getAIClient } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Every indexed chunk is about this one event. Terse user questions (e.g. just
// "accommodation") embed too far from the event-specific chunks to clear the
// similarity floor — but the same chunks match once the query carries event
// context. So anchor every query to the event domain before embedding, which
// makes one-word questions retrieve as well as fully-phrased ones.
const EVENT_CONTEXT = "Ashara Mubaraka 1448H, Chicago Relay Center — visitor information for mumineen:";

// Religious queries (Vaaz Talaqi, Iqtibasaat, Lisan ud Dawat) are anchored to their own
// domain so terse questions ("what does aaeen mean", "majlis 1 theme") embed near the
// religious chunks rather than the logistics ones.
const RELIGIOUS_CONTEXT =
  "Ashara Mubaraka majalis — Vaaz Talaqi, Iqtibasaat, and Lisan ud Dawat word meanings for mumineen:";

// text-embedding-3-small similarities run lower in absolute terms than larger
// models, so keep the floor modest. Too high (e.g. 0.55) drops valid matches.
const MATCH_THRESHOLD = 0.42;

// Shared retrieval: embed the (context-anchored) query and run a pgvector match RPC,
// formatting the rows into the agent-facing context block.
async function retrieveContext(
  rpc: "match_site_content" | "match_religious_content",
  contextPrefix: string,
  query: string,
  topK: number,
): Promise<string> {
  const openai = getAIClient();
  const supabase = getSupabaseAdmin();

  const embeddingRes = await openai.embeddings.create({
    model: AI_EMBEDDING_MODEL,
    input: `${contextPrefix} ${query}`,
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  const { data, error } = await supabase.rpc(rpc, {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: MATCH_THRESHOLD,
    match_count: topK,
  });

  if (error) {
    console.error(`${rpc} retrieval failed:`, error);
    return "";
  }

  if (!data?.length) return "";

  return data
    .map((row: { page_title: string; content: string }) => {
      return `[${row.page_title}]\n${row.content}`;
    })
    .join("\n\n---\n\n");
}

export async function retrieveSiteContext(query: string, topK = 5): Promise<string> {
  return retrieveContext("match_site_content", EVENT_CONTEXT, query, topK);
}

// Religious-content retrieval, backing the answer_religious_questions tool. Queries the
// dedicated religious_content store — never the logistics site_content.
export async function retrieveReligiousContext(query: string, topK = 5): Promise<string> {
  return retrieveContext("match_religious_content", RELIGIOUS_CONTEXT, query, topK);
}
