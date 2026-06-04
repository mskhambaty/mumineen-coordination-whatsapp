# Relay Updates Feed

## Overview

The public Chicago Relay Center page (static HTML on asharamubaraka.net) loads its
**Latest updates** section from a JSON feed. This app serves that feed and provides the
portal UI to author updates.

## Feed Contract (shared with the static page)

`GET /api/relay-updates` — public, CORS `Access-Control-Allow-Origin: *`,
`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.

Returns published updates, newest first:

````json
[{
  "id": "4b6c…-uuid",
  "date": "2026-06-10",
  "title": "…",
  "body": "…",
  "category": "travel",
  "link": "https://www.chicagorelaycenter.com/parking",
  "cta": "View your zone"
}]
````

`category` ∈ `urgent | schedule | travel | advisory` (lowercase). `id` (row UUID) becomes
the card's `data-id`; optional `link`/`cta` render a CTA anchor (new tab, `rel="noopener"`)
and are omitted when unset. The page HTML-escapes fields client-side and falls back to
baked-in updates if the fetch fails.

**Static-page configuration (manual, outside this repo):** set the page's
`UPDATES_ENDPOINT` constant to `https://<this-app-domain>/api/relay-updates` and make sure
its category tabs match the four categories above.

## Authoring

- Portal page: **External → Relay Updates** (`/admin/relay-updates`) — table + create/edit
  modal with publish toggle. Admin/leadership only.
- Lifecycle: create + edit + unpublish (no hard delete).
- API: `GET/POST /api/admin/relay-updates`, `PUT /api/admin/relay-updates/[id]`
  (admin key + acting `user_id`; server checks admin/leadership).

## Agent Indexing

Every successful write re-indexes all published updates into `site_content` under
`page_url = 'updates://relay'` (one chunk per update), so `get_site_content_faq` answers
from the same news. Link/CTA fields are deliberately excluded from the chunks — the agent
may only share the asharamubaraka.net URL. Indexing failures are logged and never fail
the write. Source: `src/lib/relay-updates/index-updates.ts`.

## Data

Table `relay_updates` — see [database.md](./database.md). Validation caps: title ≤ 200
chars, body ≤ 1000 chars, link ≤ 500 (http/https), CTA ≤ 80 (requires link), date `yyyy-mm-dd`.
