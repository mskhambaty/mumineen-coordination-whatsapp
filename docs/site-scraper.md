# RAG Retrieval (site scraper retired)

## Status

The daily **website scraper was retired in June 2026.** It fetched
`ashara1448relay.chicagojamaat.org` and sliced the single-page site into ~160 chunks of generic
homepage/navigation boilerplate. That boilerplate made up ~70% of the `site_content` corpus and
crowded out the curated answers in vector search — the agent would deny information that was
actually indexed (the WiFi password incident). Since every real answer lives in curated content,
the scraper was deleted (cron, routes, `scrape-site.ts`) and its rows purged.

**Removed:** `src/lib/scraper/scrape-site.ts`, `/api/cron/scrape`, `/api/admin/scrape`, the
`/api/cron/scrape` entry in `vercel.json`, and the "Run scrape" button on the Prompt page.

## What populates the RAG corpus now

`site_content` is filled **only by curated content**, all managed from the admin UI:

| Source | `page_url` namespace | Managed on |
|--------|----------------------|------------|
| Uploaded documents (CSV/Excel/Word/PDF) | `knowledge://<docId>` | Knowledge Base page |
| Per-department FAQ buckets | `faqbucket://<deptId>` | Knowledge Base page |
| Conversation-learned / knowledge-gap FAQs | `faqsheet://...` | Knowledge Gaps page |
| Public relay updates feed | `updates://relay` | Relay Updates page |

Indexing lives in [`src/lib/knowledge/index-content.ts`](../src/lib/knowledge/index-content.ts)
(`indexChunksForPage`, `indexKnowledgeChunks`, `indexFaqBucket`).

## RAG Retrieval (`retrieveSiteContext`)

[`src/lib/scraper/retrieve-site-context.ts`](../src/lib/scraper/retrieve-site-context.ts):

1. **Dual-embed** the query — once raw (so specific terms like "wifi password" rank the right
   FAQ chunk highest) and once anchored with an event-context prefix (so terse one-word
   questions still match). Both use `AI_EMBEDDING_MODEL` from `src/lib/ai/model.ts`.
2. Call the `match_site_content` RPC for each embedding with `match_threshold = 0.3`, merge
   raw-first, and dedupe.
3. `get_site_content_faq` requests a **top-10** window (`getIndexedInfo(..., 10)` in
   `src/lib/agent/tools.ts`) so a single-chunk FAQ can't be crowded out.
4. Format as `[Page Title — Source: <url>]\nContent` blocks and inject into the agent context.

## Changing the Embedding Model

If you switch from `text-embedding-3-small` (1536 dims):
1. Update the model string in `retrieve-site-context.ts` and `index-content.ts`.
2. Migrate the `embedding` column dimensions in `site_content` + `religious_content`.
3. Re-index all curated content (re-upload docs / re-save FAQ buckets).
