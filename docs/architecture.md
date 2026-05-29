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
    │       ├─ OpenAI Chat (gpt-4.1-mini, tools enabled)
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
    ├─ embed with text-embedding-3-small
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

## Layer Boundaries

| Layer | Path | Responsibility |
|-------|------|---------------|
| API Routes | `src/app/api/` | HTTP entry points only — parse, validate, delegate |
| Agent | `src/lib/agent/` | OpenAI loop, tool dispatch |
| Permissions | `src/lib/permissions.ts` | Role and tool access rules |
| Supabase | `src/lib/supabase/` | All database reads and writes |
| Meta | `src/lib/meta/` | Meta Graph API calls, signature verification |
| WhatsApp Parser | `src/lib/whatsapp/` | Raw webhook payload → typed structs |
| Scraper | `src/lib/scraper/` | Site fetch, chunking, embedding, retrieval |
| Env | `src/lib/env.ts` | Env var lookup with mixed-case alias support |
