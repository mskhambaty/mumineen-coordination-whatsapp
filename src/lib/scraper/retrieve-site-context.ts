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
// models, so keep the floor modest. At 0.42, short curated FAQ chunks (e.g. a
// one-line WiFi or bathroom answer) were falling below the floor and never
// retrieved, even on direct queries — so a freshly-uploaded FAQ wouldn't answer.
// 0.30 lets those surface; the agent already ignores irrelevant context, and
// topK still caps how much is returned.
const MATCH_THRESHOLD = 0.3;

type MatchRow = { page_title: string; content: string; source_url?: string | null; category?: string | null; year_hijri?: string | null };

// Shared retrieval: embed the (context-anchored) query and run a pgvector match RPC,
// formatting the rows into the agent-facing context block. `allowedCategories` (religious
// only) post-filters rows by their denormalized category so e.g. tazyeen (decorations) never
// leaks into a sermon-content answer.
async function retrieveContext(
  rpc: "match_site_content" | "match_religious_content",
  contextPrefix: string,
  query: string,
  topK: number,
  allowedCategories?: string[],
  allowedYear?: string | null,
): Promise<string> {
  const openai = getAIClient();
  const supabase = getSupabaseAdmin();

  // Embed the query TWO ways and merge:
  //  - raw query    -> specific terms ("wifi password", "bathrooms") rank the right FAQ
  //                    chunk highest, so single-chunk FAQs surface reliably.
  //  - anchored      -> the event-context prefix helps terse one-word questions match.
  // The anchored-only approach made generic homepage chunks dominate and buried specific
  // FAQs right at the cutoff (they flickered in/out by phrasing). Raw results are merged
  // FIRST so the specific answer leads the context the model reads.
  const [rawEmb, ctxEmb] = await Promise.all([
    openai.embeddings.create({ model: AI_EMBEDDING_MODEL, input: query }),
    openai.embeddings.create({ model: AI_EMBEDDING_MODEL, input: `${contextPrefix} ${query}` }),
  ]);

  // When filtering by category/year, pull a wider window so enough allowed rows survive.
  const matchCount = allowedCategories || allowedYear ? topK * 3 : topK;
  const runMatch = (embedding: number[]) =>
    supabase.rpc(rpc, {
      query_embedding: JSON.stringify(embedding),
      match_threshold: MATCH_THRESHOLD,
      match_count: matchCount,
    });
  const [rawRes, ctxRes] = await Promise.all([runMatch(rawEmb.data[0].embedding), runMatch(ctxEmb.data[0].embedding)]);

  if (rawRes.error) console.error(`${rpc} retrieval failed (raw):`, rawRes.error);
  if (ctxRes.error) console.error(`${rpc} retrieval failed (anchored):`, ctxRes.error);

  // Merge raw-first (specific FAQ chunks lead), dedupe by title+content.
  const seen = new Set<string>();
  let rows: MatchRow[] = [];
  for (const r of [...((rawRes.data ?? []) as MatchRow[]), ...((ctxRes.data ?? []) as MatchRow[])]) {
    const key = `${r.page_title ?? ""}::${(r.content ?? "").slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
  if (allowedCategories) {
    // Keep rows whose category is allowed (or null/unknown, to be safe).
    rows = rows.filter((r) => !r.category || allowedCategories.includes(r.category));
  }
  if (allowedYear) {
    // STRICT year scoping: a 1448 query must not match the embedded 1447 rows (and vice-versa).
    // Null-year rows (e.g. the misc guardrail block) are excluded when a concrete year is required.
    rows = rows.filter((r) => r.year_hijri === allowedYear);
  }
  rows = rows.slice(0, topK);
  if (!rows.length) return "";

  return rows
    .map((row) => {
      const src = row.source_url ? ` — Source: ${row.source_url}` : "";
      return `[${row.page_title}${src}]\n${row.content}`;
    })
    .join("\n\n---\n\n");
}

// topK=10 (not 5): curated FAQ docs were being crowded out of the top 5 by generic
// scraped homepage chunks for short queries (e.g. "medical emergency" returned only
// homepage boilerplate, not the Medical FAQ). A wider window lets the specific FAQ
// reach the model even when it ranks below the homepage chrome.
export async function retrieveSiteContext(query: string, topK = 10): Promise<string> {
  return retrieveContext("match_site_content", EVENT_CONTEXT, query, topK);
}

// Religious-content retrieval, backing the answer_religious_questions tool. Queries the
// dedicated religious_content store — never the logistics site_content. `categories` (e.g.
// reflection+al_dars+overview for sermon questions) keeps decoration (tazyeen) chunks out.
export async function retrieveReligiousContext(
  query: string,
  topK = 5,
  categories?: string[],
  year?: string | null,
): Promise<string> {
  return retrieveContext("match_religious_content", RELIGIOUS_CONTEXT, query, topK, categories, year);
}
