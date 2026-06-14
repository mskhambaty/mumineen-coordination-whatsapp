# Architecture Overview

## System Summary

A Next.js (App Router, Node.js runtime) application deployed on Vercel.  
There is no frontend UI — all interaction happens through WhatsApp.

## Request Flow

```
WhatsApp User
    │ sends text message
    ▼
Meta WhatsApp Cloud API
    │ HTTP POST (signed with X-Hub-Signature-256)
    ▼
POST /api/whatsapp/webhook          (src/app/api/whatsapp/webhook/route.ts)
    │
    ├─ verifyMetaSignature()         (src/lib/meta/whatsapp.ts)
    ├─ extractIncomingMessages()     (src/lib/whatsapp/parser.ts)
    ├─ recordInboundMessage()        (src/lib/supabase/server.ts) — dedup by whatsapp_message_id
    ├─ getOrCreateWhatsappUser()     (src/lib/supabase/server.ts) — upsert user + role
    ├─ touchConversationSession()    (src/lib/supabase/server.ts)
    ├─ runAgent()                    (src/lib/agent/run-agent.ts)
    │       ├─ retrieveSiteContext() (src/lib/scraper/retrieve-site-context.ts) — RAG lookup over curated FAQ/docs
    │       ├─ OpenAI Chat (via src/lib/ai/model.ts, tools enabled)
    │       └─ executeTool()         (src/lib/agent/tools.ts) — if tool called
    │               └─ canUseTool()  (src/lib/permissions.ts) — role check
    ├─ sendWhatsAppText()            (src/lib/meta/whatsapp.ts) — reply via Meta Graph API
    ├─ recordOutboundMessage()       (src/lib/supabase/server.ts)
    └─ touchConversationSession()    (src/lib/supabase/server.ts) — update last_message_at
```

Ticket mutations use the same single bounded tool round. `update_tasks` first lists the caller's
API-scoped tickets, resolves explicit IDs/topic/filter selections in-process, then calls
`PUT /api/tasks/[id]` for each bounded match. Every write therefore still passes through the task
route's department-role authorization; partial failures are returned to the agent.

Lost-and-found reports also use the bounded tool round. `report_lost_item` / `report_found_item`
call `POST /api/lost-found`, which resolves the sender against registration data, stores a reporter
snapshot, and returns help-desk guidance. Lost reports additionally call `POST /api/escalations`
with category `lost_found` and department `Lost and Found`; found reports stop after recording.

## Knowledge base (RAG corpus)

The agent's `get_site_content_faq` retrieves from `site_content`, which is now populated
**only by curated content** — there is no website scraper. Chunks come from:

- Uploaded documents (`knowledge://<docId>`) — Knowledge Base page
- Per-department FAQ buckets (`faqbucket://<deptId>`) — Knowledge Base page
- Conversation-learned / knowledge-gap FAQs (`faqsheet://...`)
- The public relay updates feed (`updates://relay`)

> The daily `chicagorelaycenter.com` scraper was retired (June 2026): it produced ~70% of the
> corpus as generic homepage boilerplate that crowded out the curated answers and caused the
> agent to deny indexed info (e.g. WiFi). All real answers live in the curated stores above.

## Niyaz RSVP Flow

```
Admin /admin/niyaz → open event → Send RSVP request
    └─ POST /api/admin/niyaz/instances/[id]/broadcast
         resolveNiyazAudience (specific ITS / all mumineen / HOF / adults, ± non-responders)
         buildNiyazSend → button payloads "niyaz|<level>|<scope>|<date>"
         createBroadcast(recipients, quickReplyButtons) → drained inline (drainUntilEmpty, bounded)
         after send, with /api/cron/broadcast-drain as a backstop and a manual "Send pending"
         (/api/admin/templates/drain) to unstick if the cron isn't firing
Mumin taps a quick-reply button
    └─ WhatsApp webhook reads buttonPayload → resolveFamilyForPhone → recordNiyazButtonResponse
         (ind = that mumin, fam = whole family) → niyaz_rsvp (source=whatsapp) → confirmation reply
Admin event detail
    └─ GET /api/admin/niyaz/instances/[id]/responses  (per-mumin rows)
    └─ GET /api/admin/niyaz/instances  → niyaz_event_tallies → yes/no by adult/kid/family + thaal count
```

RSVP is collected day-by-day via WhatsApp quick-reply button templates (individual or whole-family),
sent by an admin per event; the button payload carries level+scope+date, the sender's phone
identifies who, and the tap is recorded in `niyaz_rsvp`. See
[meal-rsvp-feedback-digest.md](./meal-rsvp-feedback-digest.md). A default attendance baseline is seeded
from arrival dates (backfill + `seed_family_niyaz_rsvp` on registration submit/edit); button /
head-count responses override the per-mumin defaults.

## External Services

| Service | Purpose | Auth |
|---------|---------|------|
| Meta WhatsApp Cloud API | Receive messages, send replies | `WHATSAPP_ACCESS_TOKEN` |
| Meta Graph API (signature) | Verify webhook authenticity | `META_APP_SECRET` (optional) |
| OpenAI | Chat completions + embeddings | `OPENAI_API_KEY` |
| Supabase | Database (users, messages, sessions, audit, site content) | `SUPABASE_SERVICE_ROLE_KEY` |
| Vercel | Hosting, env vars, cron | — |

## Admin Dashboard Auth Flow

```
Browser (admin page)
    │ POST /api/admin/auth  { email, password }
    ▼
resolveCallerFromSession  (NOT used here — this is the login endpoint itself)
    ├─ verify credentials + bcrypt hash
    ├─ call get_user_permissions_by_id RPC → role, status, portal flags
    ├─ check active status + portal access predicate
    ├─ sign HMAC-SHA256 cookie payload { user_id, exp }
    └─ Set-Cookie: portal_session=<signed>; HttpOnly; SameSite=Lax; Path=/; 7-day TTL
    Response: { user }  (no token in body)

Subsequent admin API requests
    │ Cookie: portal_session=<signed>  (sent automatically by browser)
    ▼
resolveCallerFromSession  (src/lib/api/auth.ts)
    ├─ verify cookie HMAC signature
    ├─ call get_user_permissions_by_id RPC  (per-request — role changes take effect immediately)
    └─ build CallerContext with portal flags
    ▼
requirePortalCaller(req, predicate)  (src/lib/api/portal-auth.ts)
    ├─ 401 → invalid/missing session
    ├─ 403 → predicate failure (wrong role / permission)
    └─ 200 → handler proceeds

POST /api/admin/auth/logout  (public — no session required)
    └─ Clears portal_session cookie
```

`x-admin-key` (`ADMIN_API_KEY`) bypasses the cookie check and is used only by agent tools and cron jobs — never by the browser.

## Layer Boundaries

| Layer | Path | Responsibility |
|-------|------|---------------|
| API Routes | `src/app/api/` | HTTP entry points only — parse, validate, delegate |
| API Contract | `docs/openapi.yaml` | Public contract for route parameters, bodies, auth, and schemas |
| Agent | `src/lib/agent/` | OpenAI loop, tool dispatch |
| AI Config | `src/lib/ai/model.ts` | Central OpenAI client, model names, temperatures, token limits |
| Permissions | `src/lib/permissions.ts` | Role and tool access rules |
| Portal Auth | `src/lib/api/auth.ts`, `src/lib/api/portal-auth.ts` | Session cookie verification, per-request permission resolution, route guard |
| Admin Client | `src/lib/admin/client.ts` | Cookie-based fetch helper; redirects to login on 401 |
| Supabase | `src/lib/supabase/` | All database reads and writes |
| Meta | `src/lib/meta/` | Meta Graph API calls, signature verification |
| WhatsApp Parser | `src/lib/whatsapp/` | Raw webhook payload → typed structs |
| Retrieval | `src/lib/scraper/retrieve-site-context.ts` | RAG vector search over curated `site_content` (scraper retired) |
| Env | `src/lib/env.ts` | Env var lookup with mixed-case alias support |
