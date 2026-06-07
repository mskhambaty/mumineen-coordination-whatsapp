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
    │       ├─ retrieveSiteContext() (src/lib/scraper/retrieve-site-context.ts) — RAG lookup
    │       ├─ OpenAI Chat (via src/lib/ai/model.ts, tools enabled)
    │       └─ executeTool()         (src/lib/agent/tools.ts) — if tool called
    │               └─ canUseTool()  (src/lib/permissions.ts) — role check
    ├─ sendWhatsAppText()            (src/lib/meta/whatsapp.ts) — reply via Meta Graph API
    ├─ recordOutboundMessage()       (src/lib/supabase/server.ts)
    └─ touchConversationSession()    (src/lib/supabase/server.ts) — update last_message_at
```

## Cron Flow

```
Vercel Cron (vercel.json)
    │ POST /api/cron/scrape  (******
    ▼
scrapeSite()                        (src/lib/scraper/scrape-site.ts)
    ├─ fetch pages from chicagorelaycenter.com
    ├─ parse with cheerio → content chunks
    ├─ embed with AI_EMBEDDING_MODEL from src/lib/ai/model.ts
    └─ upsert to site_content table  (Supabase)
```

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
| Scraper | `src/lib/scraper/` | Site fetch, chunking, embedding, retrieval |
| Env | `src/lib/env.ts` | Env var lookup with mixed-case alias support |
