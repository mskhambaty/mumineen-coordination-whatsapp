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
| [ashara-religious-content.md](./ashara-religious-content.md) | Waaz Talaqi: per-majlis content model, `/admin/ashara` dashboard, daily seed + Lisan translate, theme index, answer routing & length budget |
| [ollama-ab-testing.md](./ollama-ab-testing.md) | Ollama cloud A/B testing page for model comparison |
| [permissions.md](./permissions.md) | User roles (`visitor`, `committee`, `admin`), tool access matrix |
| [access-control.md](./access-control.md) | **Canonical portal role × page matrix** — who can see/do what on each `/admin` page, and the access tiers |
| [database.md](./database.md) | Supabase schema: all tables, RLS policies, migrations |
| [site-scraper.md](./site-scraper.md) | RAG retrieval over curated content (website scraper retired) |
| [environment.md](./environment.md) | All environment variables, aliases, Vercel setup |
| [email.md](./email.md) | Postmark password reset and daily task digest email |
| [contributing.md](./contributing.md) | Rules for adding features, updating docs, new files |
| [task-management.md](./task-management.md) | Task management system: roles, API routes, agent tools |
| [transcript-parser.md](./transcript-parser.md) | AI-powered WhatsApp transcript parsing service |
| [admin-dashboard.md](./admin-dashboard.md) | Admin web dashboard: pages, auth, features |
| [escalation.md](./escalation.md) | Escalation & site support: triggers, roles, on-call, notifications (design spec) |
| [triage-desk-design.md](./superpowers/specs/2026-06-09-triage-desk-design.md) | Triage Desk UI: Kanban board, SLA dashboard, ticket detail view |
| [relay-updates.md](./relay-updates.md) | Public relay-page updates feed: endpoint, authoring UI, agent indexing |
| [accommodations-matching.md](./plans/accommodations-matching.md) | Accommodations host-guest utaro matching module: import, rollups, matching |
| [meal-rsvp-feedback-digest.md](./meal-rsvp-feedback-digest.md) | Jaman meal RSVP, feedback capture, nightly department digest, and the manual template send console |
| [openapi.yaml](./openapi.yaml) | API-first contract for all `src/app/api/**` routes |

## Key File Locations

```
src/app/api/whatsapp/webhook/route.ts    — Meta webhook handler (GET + POST)
src/app/api/cron/daily-digest/route.ts   — Daily task digest email cron endpoint
src/app/api/ollama/models/route.ts       — Ollama model list proxy
src/app/api/ollama/chat/route.ts         — Ollama A/B chat completion endpoint
src/app/api/auth/forgot-password/route.ts — Password reset email endpoint (any non-visitor user, via canAccessPortal)
src/lib/admin/email.ts                   — Case-insensitive email normalization/matching for auth lookups
src/lib/agent/run-agent.ts               — AI agent orchestration
src/lib/mumineen/sender-profile.ts       — Phone→registration profile for Sender Context + inbox User Profile panel
src/lib/ai/model.ts                      — Central OpenAI model/client configuration
src/lib/email/postmark.ts                — Postmark email service
src/lib/issues/notify.ts                 — Department issue-contact email + WhatsApp template notifications
src/lib/agent/tools.ts                   — Tool definitions + execution
src/lib/permissions.ts                   — Agent tool roles + canUseTool()
src/lib/admin/access.ts                  — Portal page/route access predicates (see docs/access-control.md)
src/components/admin/AdminNav.tsx        — Portal nav + per-link access tiers
src/lib/supabase/server.ts               — All Supabase operations
src/lib/meta/whatsapp.ts                 — Meta Graph API calls + signature verification
src/lib/whatsapp/send-template.ts        — Standardized template-send pipeline (resolve→validate→send→log) for all notifications
src/lib/whatsapp/templates.ts            — Template descriptor + components builder + body preview
src/lib/whatsapp/template-settings.ts    — Per-template friendly-name + active flag (get/upsert) for the send console
src/app/api/admin/templates/settings/route.ts — PUT template friendly-name / active flag (admin/leadership)
src/app/api/admin/templates/segments/route.ts — GET Niyaz reach-segment sizes (free/paid split) for the console header
src/lib/escalation/notify.ts             — On-call escalation email + WhatsApp template notifications
src/lib/escalation/activity.ts           — Escalation activity log (fire-and-forget)
src/lib/escalation/sla.ts               — SLA config cache + deadline computation
src/app/api/admin/issues/route.ts        — Issues CRUD (list + create)
src/app/api/admin/issues/[issueId]/route.ts — Issue detail (GET/PUT/DELETE)
src/app/api/admin/issues/[issueId]/link/route.ts — Link/unlink escalations to issues
src/app/api/admin/issues/[issueId]/resolve/route.ts — Resolve issue + all linked escalations
src/app/api/admin/escalations/stats/route.ts — KPI stats for inbox header
src/app/api/admin/escalations/[phoneE164]/suggestions/route.ts — AI suggestions (matching issues + resolution history)
src/lib/escalation/suggestions-cache.ts    — In-memory TTL cache for AI suggestions
src/lib/accommodations/import.ts         — Host spreadsheet XLSX import (upsert by ITS)
src/lib/accommodations/rollups.ts        — Guest/host demographic rollups + capacity math
src/lib/accommodations/matching.ts       — Matching logic, confirm/reject lifecycle
src/lib/whatsapp/parser.ts               — Incoming webhook payload parsing
src/lib/scraper/retrieve-site-context.ts — RAG vector search over curated site_content
src/lib/knowledge/index-content.ts       — Embed + index curated docs/FAQ buckets into site_content
src/lib/knowledge/religious-topics.ts    — Waaz Talaqi topics: routing, themes, overview/facets
src/app/admin/ashara/page.tsx            — Ashara Daily Content dashboard (per-majlis grid)
src/lib/env.ts                           — Env var lookup with alias support
public/templates/mumineen-roster-template.xlsx — Downloadable Mumineen roster import template
supabase/migrations/                     — All database migrations
src/app/api/relay-updates/route.ts       — Public relay updates JSON feed
src/lib/rsvp/meal-rsvp.ts                — Per-mumin Niyaz RSVP (niyaz_rsvp): grids, family/individual set-cascade, tallies (max/min), unregistered RSVP helpers, daily-button recording
src/lib/rsvp/niyaz-prompt.ts             — Daily RSVP-template audiences (ITS/mumineen/HOF/adults) + button payloads + single-prompt creation for unregistered callers
src/lib/feedback/record.ts               — Append-only feedback capture (area→department tagged)
src/lib/whatsapp/audience.ts             — Send-console audience resolution + free/paid window split + roster-by-phone enrichment (resolveRosterByPhone) + Niyaz reach segments (segmentCounts, segment_* audiences)
src/lib/whatsapp/audience-csv.ts         — Parse an uploaded audience CSV (export/failures format) into broadcast recipients (csv_upload)
src/lib/whatsapp/broadcast.ts            — Throttled template broadcast engine (queue + drain; drainUntilEmpty + failure categorization)
src/app/api/admin/templates/drain/route.ts  — Manual "Send pending" — bounded drain trigger (admin/leadership)
src/app/api/admin/templates/broadcasts/[id]/failures/route.ts — Per-recipient broadcast failure list (JSON/CSV, admin/leadership)
src/lib/digest/run.ts                    — Nightly department digest: aggregate→AI→store→distribute
src/app/api/cron/department-digest/route.ts — Nightly department digest cron (03:00 UTC (10pm Chicago, CDT))
src/app/api/cron/broadcast-drain/route.ts   — Template broadcast drain cron (every minute)
```

## Quick Reference: Adding a New Feature

1. Read this index.
2. Read the doc for the relevant feature area.
3. Read [contributing.md](./contributing.md) for file and doc conventions.  Then when building always work API first.
4. Add or update the matching doc when your feature is done.
5. Update [openapi.yaml](./openapi.yaml) whenever an API route changes.
