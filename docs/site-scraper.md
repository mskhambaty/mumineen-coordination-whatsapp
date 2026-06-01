# Site Scraper & RAG Context

## Overview

A daily cron job fetches pages from the official Chicago Relay Center site, extracts content, generates embeddings, and stores them in Supabase.  
At query time, the agent retrieves the most relevant chunks and injects them into the system prompt.

## Files

| File | Purpose |
|------|---------|
| `src/lib/scraper/scrape-site.ts` | Fetches, parses, embeds, and stores site content |
| `src/lib/scraper/retrieve-site-context.ts` | Embeds a query and runs vector search |
| `src/app/api/cron/scrape/route.ts` | Cron HTTP endpoint |
| `supabase/migrations/20260529134500_site_content.sql` | `site_content` table + indexes |
| `supabase/migrations/20260529134501_match_site_content.sql` | `match_site_content` RPC |

## Scrape Pipeline (`scrapeSite`)

1. Iterate over `PAGES_TO_SCRAPE`:
   ```
   / /schedule /parking /registration /directions /faq /contact
   ```
2. Fetch each page from `https://www.chicagorelaycenter.com{path}`.
3. Parse with Cheerio: extract `<h1>`/`<h2>`/`<h3>` + following paragraph text.  
   Chunks shorter than 30 characters are discarded.  
   Each chunk is trimmed to 1500 characters.
4. Embed all chunks using `AI_EMBEDDING_MODEL` from `src/lib/ai/model.ts` in batches of 100.
5. Mark all existing `site_content` rows as `is_current = false`.
6. Insert new rows with `is_current = true`.

## RAG Retrieval (`retrieveSiteContext`)

1. Prefix the query with a short **event-context anchor** (`EVENT_CONTEXT`), then embed it with
   `AI_EMBEDDING_MODEL` from `src/lib/ai/model.ts`. The anchor is what lets terse questions
   (e.g. just "accommodation") retrieve as well as fully-phrased ones — without it, one-word
   queries embed too far from the event-specific chunks to clear the floor.
2. Call `match_site_content` Supabase RPC with:
   - `match_threshold: 0.42` (cosine similarity — modest, since `text-embedding-3-small`
     similarities run lower in absolute terms; too high drops valid matches)
   - `match_count: 5` (top-K results)
3. Format results as `[Page Title]\nContent` blocks separated by `---`.
4. Inject into the agent system prompt under `## Current Site Information`.

If retrieval fails or returns no results, the agent continues without site context.

## Cron Endpoint

```
POST /api/cron/scrape
Authorization: ******
```

Configured in `vercel.json` for daily execution.  
If the `Authorization` header does not match `CRON_SECRET`, returns `401 Unauthorized`.

### Manual trigger

Admins can re-scrape on demand from the **Prompt** page — a **Run scrape** button next to the
`get_site_content_faq` tool calls `POST /api/admin/scrape` (same work as the cron, gated by the
admin key instead of `CRON_SECRET`). This avoids waiting for the daily cron after a site update.

## Adding or Changing Scraped Pages

Edit the `PAGES_TO_SCRAPE` array in `scrape-site.ts`.  
No migration needed — new pages are just additional rows in `site_content`.

## Changing the Embedding Model

If you switch from `text-embedding-3-small` (1536 dimensions) to a different model:
1. Update the model string in both `scrape-site.ts` and `retrieve-site-context.ts`.
2. Create a migration to change the `embedding` column dimensions in `site_content`.
3. Re-run the scrape cron to regenerate all embeddings.

## Tuning Retrieval

- **`match_threshold`** — lower values return more (potentially less relevant) results.
- **`topK`** (`match_count`) — increase to inject more context, at the cost of more tokens.
- Both are hardcoded in `retrieve-site-context.ts`; move to env vars if tuning is frequent.
