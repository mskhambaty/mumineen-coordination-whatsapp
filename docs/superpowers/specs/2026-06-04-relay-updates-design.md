# Relay Updates Feed — Design

**Date:** 2026-06-04
**Status:** Approved

## Problem

The public Chicago Relay Center page is a static HTML file hosted on `asharamubaraka.net` (a host we don't control). Its "Latest updates" section fetches a JSON feed so news can be posted without redeploying the page. The feed URL is currently hardcoded to `https://ashara1448relay.chicagojamaat.org/relay/updates.json`, which is a different (ASP.NET) host where that path 404s today.

We will serve the feed from this app instead, and build portal UI so designated jamaat members can author updates.

**Page contract** (from the static page's JS):
- Fetched with a simple `GET` (`cache: 'no-store'`), so the response must send `Access-Control-Allow-Origin: *` (cross-origin page).
- Schema: JSON array of `{ "date": "yyyy-mm-dd", "title": string, "body": string, "category": string }` plus three **optional, back-compatible** properties:
  - `id` — rendered as the card's `data-id`. We auto-emit the row UUID (decided: not an authored slug).
  - `link` — URL; the card renders a CTA anchor to it (new tab, `rel="noopener"`).
  - `cta` — label for that CTA (page falls back to its default label when absent).
- Categories are **type-based**: `urgent` | `schedule` | `travel` | `advisory` (lowercase in JSON). The currently-downloaded page version still shows the older general/accommodation/transport tabs; the page is being updated to the new category set alongside this feature.
- The page sorts by `date` descending and HTML-escapes all fields client-side.
- On fetch failure it renders baked-in fallback updates, so feed errors are non-fatal.
- **One-time external change (manual, outside this repo):** the page's `UPDATES_ENDPOINT` constant must be repointed to `https://<this-app-domain>/api/relay-updates` and the page redeployed by its host.

## Decisions (made during brainstorming)

1. **Plumbing:** repoint the static page's endpoint directly at this app (no proxy on the ASP.NET host, no file pushing).
2. **Author roles:** admin/leadership only (categories changed from department-aligned to type-based — `urgent`/`schedule`/`travel`/`advisory` — so the earlier department-mapping idea was dropped).
3. **Lifecycle:** create + edit + unpublish. No hard delete.
4. **Bot synergy:** published updates are auto-indexed into `site_content` so the WhatsApp agent answers from the same news.

## Data model

New migration creating `relay_updates` (committed to `supabase/migrations/` **and** applied with the matching ledger version — no repeat of the #57 drift):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `date` | date not null | Display date shown on the page |
| `title` | text not null | ≤ 200 chars (API-validated) |
| `body` | text not null | ≤ 1000 chars (API-validated) |
| `category` | text not null | `check (category in ('urgent','schedule','travel','advisory'))` |
| `link` | text nullable | Optional CTA URL (http/https, ≤ 500 chars, API-validated) |
| `cta` | text nullable | Optional CTA label (≤ 80 chars); only allowed when `link` is set |
| `published` | boolean not null default true | Unpublish = retract without losing history |
| `created_by` | uuid FK → `whatsapp_users(id)` on delete set null | Attribution |
| `created_at` / `updated_at` | timestamptz not null default now() | `updated_at` app-managed |

Index: `(published, date desc)`. RLS enabled, no policies (service-role only — house style).

## Public feed endpoint

`GET /api/relay-updates` — unauthenticated.

- Selects `published = true` rows ordered `date desc`, serialized to exactly the page schema: `[{id, date, title, body, category, link?, cta?}]` with `date` formatted `yyyy-mm-dd`. `id` is the row UUID (always emitted); `link`/`cta` are included only when set.
- Headers: `Access-Control-Allow-Origin: *`; `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` (posts visible within ~1 minute; trivial function load). Minimal `OPTIONS` handler for safety.
- On DB error: return 500 — the page's fallback covers it.

## Permissions

Admin/leadership only, for **all four categories** — reuses the existing `isAdminOrLeadership()` check (`role = 'admin'` or `global_role = 'leadership_admin'`). No new permission helper or department mapping. Create, edit, and unpublish all use the same gate.

Auth follows the house portal convention: shared `x-admin-key` header + acting `user_id` in the request body; the server resolves the role from the DB. (Portal-wide per-user auth strength is an existing, separate concern — same class as ticket #58 — and is not expanded here.)

## Admin API

- `GET /api/admin/relay-updates` — all rows including unpublished, with creator display name. Requires admin key.
- `POST /api/admin/relay-updates` — create. Body: `{user_id, date, title, body, category, link?, cta?, published?}`. Validates: category enum (`urgent|schedule|travel|advisory`), `yyyy-mm-dd` date, title/body required and within length caps, `link` http/https when present, `cta` only with `link`; then the admin/leadership check on `user_id`.
- `PUT /api/admin/relay-updates/[id]` — edit any field and toggle `published`. Same validation + permission rule.
- No `DELETE` route.

Every successful write triggers re-indexing (below) — failures of the indexing step are logged but do not fail the write.

## Bot indexing

On create/edit/publish-toggle, re-index **all currently published updates** into `site_content` under `page_url = 'updates://relay'` using the existing delete-then-insert helper pattern (`indexChunksForPage` in `src/lib/knowledge/index-content.ts`, like `indexFaqBucket`). One chunk per update: `"[<date>] <Category> — <title>: <body>"`. The agent's `get_site_content_faq` then retrieves the same news the public page shows. Unpublishing an update removes it from the next re-index.

## Admin UI

New page `/admin/relay-updates`, added to `AdminNav` in the External group:

- Table: date, title, category badge, published/unpublished badge, author, updated-at.
- Create/Edit modal: date (defaults to today), title, body, category dropdown (Urgent / Schedule / Travel / Advisory), optional link URL + CTA label, published toggle.
- Page access mirrors the API rule: admin/leadership only. Others don't see the nav item (and the API enforces server-side regardless).

## Error handling

- Feed: DB failure → 500; the static page silently keeps its fallback content.
- Admin writes: validation errors → 400 with a field-specific message; permission failures → 403; unknown id → 404.
- Indexing failures: log and continue (the feed is the source of truth; the vector store catches up on the next write).

## Testing

Vitest (in `src/lib/__tests__/`, mirroring existing tests):
- Write validation: category enum, date format, title/body presence and length caps; non-admin/leadership caller rejected.
- Feed serializer: row → page-schema object (date formatting, field passthrough, published filtering).

## Documentation updates (per contributing.md)

- New `docs/relay-updates.md` — feature doc including the static-page `UPDATES_ENDPOINT` change instruction.
- `docs/openapi.yaml` — the three new routes.
- `docs/database.md` — `relay_updates` table.
- `docs/index.md` — document-map entry.

## Out of scope

- New categories beyond the four (the static page hardcodes its tabs; adding one is a coordinated page + app change).
- Delegating posting rights beyond admin/leadership (e.g. a publisher membership) — add later if demand appears.
- Hard delete, scheduling/expiry of updates, images/rich text.
- Changing the portal's shared-key auth model.
