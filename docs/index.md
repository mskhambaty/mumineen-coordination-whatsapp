# Mumineen Coordination WhatsApp — Documentation Index

> **Before writing any code, read this index first.**  
> It tells you what exists, where it lives, and which doc to consult.

## What This App Does

WhatsApp-only Next.js backend for **Anjuman e Saifee Chicago** Ashara Mubarak 1447H coordination.  
Mumineen text the registered WhatsApp number → Meta webhook fires → AI agent replies in context.

## Document Map

| Doc | What it covers |
|-----|---------------|
| [architecture.md](./architecture.md) | Full system overview: request flow, layers, external services |
| [whatsapp-webhook.md](./whatsapp-webhook.md) | Meta webhook setup, inbound/outbound flow, deduplication |
| [ai-agent.md](./ai-agent.md) | OpenAI agent loop, system prompt, tool-calling, model config |
| [permissions.md](./permissions.md) | User roles (`visitor`, `committee`, `admin`), tool access matrix |
| [database.md](./database.md) | Supabase schema: all tables, RLS policies, migrations |
| [site-scraper.md](./site-scraper.md) | Daily site scrape, embedding pipeline, RAG retrieval |
| [environment.md](./environment.md) | All environment variables, aliases, Vercel setup |
| [contributing.md](./contributing.md) | Rules for adding features, updating docs, new files |
| [task-management.md](./task-management.md) | Task management system: roles, API routes, agent tools |
| [transcript-parser.md](./transcript-parser.md) | AI-powered WhatsApp transcript parsing service |
| [admin-dashboard.md](./admin-dashboard.md) | Admin web dashboard: pages, auth, features |

## Key File Locations

```
src/app/api/whatsapp/webhook/route.ts    — Meta webhook handler (GET + POST)
src/app/api/cron/scrape/route.ts         — Daily scrape cron endpoint
src/lib/agent/run-agent.ts               — AI agent orchestration
src/lib/agent/tools.ts                   — Tool definitions + execution
src/lib/permissions.ts                   — Role types + canUseTool()
src/lib/supabase/server.ts               — All Supabase operations
src/lib/meta/whatsapp.ts                 — Meta Graph API calls + signature verification
src/lib/whatsapp/parser.ts               — Incoming webhook payload parsing
src/lib/scraper/scrape-site.ts           — Cheerio scraper + OpenAI embedding
src/lib/scraper/retrieve-site-context.ts — RAG vector search
src/lib/env.ts                           — Env var lookup with alias support
supabase/migrations/                     — All database migrations
```

## Quick Reference: Adding a New Feature

1. Read this index.
2. Read the doc for the relevant feature area.
3. Read [contributing.md](./contributing.md) for file and doc conventions.
4. Add or update the matching doc when your feature is done.
