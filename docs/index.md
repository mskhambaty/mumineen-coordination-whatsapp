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
| [email.md](./email.md) | Postmark password reset, welcome, and department digest email |
| [contributing.md](./contributing.md) | Rules for adding features, updating docs, new files |
| [task-management.md](./task-management.md) | Task management system: roles, API routes, agent tools |
| [transcript-parser.md](./transcript-parser.md) | AI-powered WhatsApp transcript parsing service |
| [admin-dashboard.md](./admin-dashboard.md) | Admin web dashboard: pages, auth, features |
| [escalation.md](./escalation.md) | Escalation & site support: triggers, roles, on-call, notifications (design spec) |
| [triage-desk-design.md](./superpowers/specs/2026-06-09-triage-desk-design.md) | Triage Desk UI: Kanban board, SLA dashboard, ticket detail view |
| [ai-grouping-assistant.md](./superpowers/specs/2026-06-11-ai-grouping-assistant-design.md) | AI-powered escalation grouping: FAB, modal, batch issue creation |
| [relay-updates.md](./relay-updates.md) | Public relay-page updates feed: endpoint, authoring UI, agent indexing |
| [accommodations-matching.md](./plans/accommodations-matching.md) | Accommodations host-guest utaro matching module: import, rollups, matching |
| [meal-rsvp-feedback-digest.md](./meal-rsvp-feedback-digest.md) | Jaman meal RSVP, feedback capture, nightly department digest, and the manual template send console |
| [lost-found.md](./lost-found.md) | Lost/found reporting tools, auto-escalation, reporter identity, and portal page |
| [webinars.md](./webinars.md) | Public `/webinars` page: ITS gate, video card grid, modal player, admin add/manage |
| [feedback-surveys.md](./feedback-surveys.md) | Targeted feedback surveys: section/question databank, group sampling (fresh-first, once-per-event), tokenized web form, 1-5 section sentiment |
| [quiz.md](./quiz.md) | Bilingual (English / Lisan ud Dawat) Ashara knowledge quiz: questions in code, shared link + self-entered ITS identity, per-question timer, server-side grading, admin-only leaderboard (score then fastest) |
| [openapi.yaml](./openapi.yaml) | API-first contract for all `src/app/api/**` routes |

## Key File Locations

```
src/app/api/whatsapp/webhook/route.ts    — Single shared Meta webhook for ALL numbers (GET + POST); routes each delivery to its account by metadata.phone_number_id
src/app/api/ollama/models/route.ts       — Ollama model list proxy
src/app/api/ollama/chat/route.ts         — Ollama A/B chat completion endpoint
src/app/api/auth/forgot-password/route.ts — Password reset email endpoint (any non-visitor user, via canAccessPortal)
src/lib/admin/email.ts                   — Case-insensitive email normalization/matching for auth lookups
src/lib/agent/run-agent.ts               — AI agent orchestration
src/lib/mumineen/sender-profile.ts       — Phone→registration profile for Sender Context + inbox User Profile panel
src/lib/lost-found/reporter.ts           — Phone→roster/user identity enrichment for lost-and-found reports
src/lib/ai/model.ts                      — Central OpenAI model/client configuration
src/lib/email/postmark.ts                — Postmark email service
src/lib/issues/notify.ts                 — Department issue-contact email + WhatsApp template notifications
src/lib/issues/link-status.ts            — Per-link episode lifecycle: resolve a conversation's open links, resolve all of an issue's links, and auto-close/reopen an issue from its links' statuses
src/lib/agent/tools.ts                   — Tool definitions + execution
src/lib/permissions.ts                   — Agent tool roles + canUseTool()
src/lib/admin/access.ts                  — Portal page/route access predicates (see docs/access-control.md)
src/components/admin/AdminNav.tsx        — Portal nav + per-link access tiers
src/lib/supabase/server.ts               — All Supabase operations
src/lib/whatsapp/accounts.ts             — WhatsApp account registry (primary + optional *_BROADCAST account; lookups by phone-number-id / WABA / label)
src/lib/whatsapp/inbound.ts              — Shared inbound webhook logic (verify/parse/process); resolves the account per delivery from metadata.phone_number_id
src/lib/meta/whatsapp.ts                 — Meta Graph API calls + signature verification (account-aware; defaults to the primary account)
src/lib/whatsapp/send-template.ts        — Standardized template-send pipeline (resolve→validate→send→log); cross-account template resolution (resolveApprovedTemplateForAnyAccount, listApprovedTemplatesForAllAccounts)
src/lib/whatsapp/templates.ts            — Template descriptor + components builder + body preview
src/lib/whatsapp/template-settings.ts    — Per-template friendly-name + active flag (get/upsert) for the send console, keyed by (WABA, template name)
src/app/api/admin/whatsapp/accounts/route.ts — GET configured WhatsApp sending numbers (no secrets) for the send console's "Send from" picker
src/app/api/admin/templates/settings/route.ts — PUT template friendly-name / active flag (admin/leadership)
src/app/api/admin/templates/segments/route.ts — GET Niyaz reach-segment sizes (free/paid split) for the console header
src/lib/escalation/notify.ts             — On-call escalation email + WhatsApp template notifications
src/lib/escalation/activity.ts           — Escalation activity log (fire-and-forget)
src/lib/escalation/sla.ts               — SLA config cache + deadline computation
src/lib/escalation/issue-grouping.ts     — Trigger B: cluster ungrouped escalations (AI) + promote same-problem ones (high-confidence, ≥2 convos) into one shared issue; pure selectPromotableClusters gate
src/app/api/admin/issues/route.ts        — Issues CRUD (list + create)
src/app/api/admin/issues/[issueId]/route.ts — Issue detail (GET/PUT/DELETE)
src/app/api/admin/issues/[issueId]/link/route.ts — Link/unlink escalations to issues
src/app/api/admin/issues/[issueId]/resolve/route.ts — Resolve issue + all linked escalations
src/app/api/departments/[id]/members/route.ts — PII-minimal active department members for ticket assignment
src/app/api/admin/issues/suggestions/route.ts       — AI grouping analysis endpoint
src/app/api/admin/issues/suggestions/apply/route.ts  — Create issue + bulk-link from suggestion
src/app/api/admin/issues/[issueId]/link-bulk/route.ts — Bulk-link escalations to existing issue
src/components/admin/AIGroupingModal.tsx              — Full-screen AI grouping modal
src/app/api/admin/escalations/stats/route.ts — KPI stats for inbox header
src/app/api/admin/escalations/[phoneE164]/suggestions/route.ts — AI suggestions (matching issues + resolution history)
src/lib/escalation/issue-match.ts         — AI + keyword issue matching (shared by dedupe + suggestions)
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
src/app/api/parking/my-passes/route.ts   — Caller-scoped parking-pass lookup (phone→own family's passes only); backs get_family_parking_passes
src/lib/parking/entry-info.ts            — Authoritative per-color parking entry guidance + rideshare drop-off (shared by the route + agent)
src/app/api/lost-found/route.ts          — Agent intake for lost/found reports; lost reports auto-escalate
src/app/api/admin/lost-found/route.ts    — Portal-member lost/found report list + manual add (POST)
src/app/api/admin/lost-found/[id]/route.ts — Edit (PUT) / Delete (DELETE) a lost/found item
src/app/api/admin/lost-found/[id]/resolve/route.ts — Mark item resolved with history tracking
src/lib/surveys/{sentiment,sampling,send,respond,tokens}.ts — Targeted feedback surveys: scoring, fresh-first sampling, commit/send, tokenized collection
src/lib/quiz/{questions,grading,service}.ts — Ashara knowledge quiz: bilingual questions+hints (source of truth in code), pure grading, shared-link/recipient load, self-identified (ITS) + recipient record, leaderboard, share open/close
src/app/quiz/[token]/page.tsx + src/app/api/quiz/[token]/route.ts — public quiz page (shared link → ITS+name, or test-link token) + GET/POST API
src/app/admin/quiz/page.tsx + src/app/api/admin/quiz/{results,test-link,share}/route.ts — admin-only leaderboard (score+time+ITS), test-link, shared link + open/close
supabase/migrations/20260625000000_quiz.sql + 20260626000000_quiz_identity.sql — quiz_recipients/quiz_answers + identity (its_number, timing, quizzes share link)
src/app/feedback/s/[token]/page.tsx       — Public tokenized feedback-survey form
src/app/api/feedback-survey/[token]/route.ts — GET form + POST submit (token-scoped, no login)
src/app/admin/surveys/page.tsx + src/app/api/admin/surveys/** — Survey console (compose/sample/send/results)
src/lib/rsvp/meal-rsvp.ts                — Per-mumin Niyaz RSVP (niyaz_rsvp): grids, family/individual set-cascade, tallies (max/min), unregistered RSVP helpers, daily-button recording
src/lib/rsvp/niyaz-prompt.ts             — Daily RSVP-template audiences (ITS/mumineen/HOF/adults, requireRegistered) + button payloads + per-recipient fields (mumin_id, family_members, eligible_family_count) + single-prompt creation for unregistered callers
src/lib/rsvp/event-config.ts             — Day-level Niyaz event config (niyaz_event_config): rsvp_event_title, lunch/dinner menus, rsvp_end_time, meals, template_code
src/lib/rsvp/niyaz-day-grouping.ts       — Pure, client-safe groupTalliesByDay(): groups per-meal events by date (lunch→dinner) for the admin days overview
src/app/admin/niyaz/page.tsx             — Niyaz days overview: days (grouped instances) with Yes count; expand → jaman; Send RSVP → composer; Edit/New via modal; click jaman → event detail
src/app/admin/niyaz/events/[id]/page.tsx — Niyaz event detail: headline counts, eligible-population Breakdown, and the RSVP responses section with By Family / By Individual tabbed views
src/components/admin/niyaz/EventFormModal.tsx — Create/Edit Niyaz event modal (POST/PATCH /api/admin/niyaz/instances), incl. manual thaal_wardi_count / actual_count
src/app/api/admin/niyaz/instances/[id]/responses/route.ts — GET per-event responses (paged server-side, uncapped) + event meta + mode-aware tally + eligible-population breakdown (niyaz_event_breakdown RPC) + crossMeal list (niyaz_event_cross_meal RPC: yes-this-meal/no-other-meal)
src/app/api/admin/niyaz/instances/[id]/families/route.ts — GET per-family RSVP grid (niyaz_event_family_grid RPC, paged server-side past the 1000-row cap) for the "By Family" view
src/app/api/admin/niyaz/instances/[id]/individuals/route.ts — GET per-member RSVP grid (niyaz_event_individual_grid RPC, paged server-side) for the "By Individual" view — eligible members incl. non-responders + WhatsApp number for CSV export
src/lib/rsvp/niyaz-breakdown.ts — assembleBreakdown + classifiers (local/mehman/guest) for the event-detail Breakdown panel
src/lib/charts/timeline.ts — buildDailyTimeline(): pure ISO-timestamps → per-day {count, cumulative} points for "over time" bar charts (niyaz responses, registrations)
src/components/admin/charts/VBars.tsx — shared vertical bar chart (daily/cumulative); used by the niyaz event-detail "Responses over time" card and the Registration "Registrations Over Time" panel
src/app/admin/niyaz/days/page.tsx        — Niyaz days view: lists prefilled 1st–10th Moharram days; click a day (or ?date=) to configure + send RSVP (composer)
src/app/api/admin/niyaz/days/route.ts    — GET list of Niyaz days (config + representative instance id per date)
src/app/api/admin/niyaz/days/[date]/route.ts — GET/PUT day-level config by date
src/app/api/admin/niyaz/instances/[id]/config/route.ts — GET/PUT day-level event config (by instance id)
src/app/api/admin/niyaz/instances/[id]/broadcast/route.ts — Send Niyaz RSVP: audience + preview (count/sample), event-config body bindings, custom per-recipient Flow/quick-reply button payloads, single-ITS test
src/components/admin/niyaz/EventRsvpComposer.tsx — Admin composer: event config (template dropdown from the 630 WABA), audience + preview, button-payload editor, send/test
src/components/admin/niyaz/BroadcastHistory.tsx — Niyaz broadcast history + delivery results (sent/delivered/read/failed), reuses /api/admin/templates/broadcasts(/[id]) filtered by audience_key=niyaz_rsvp
src/lib/whatsapp/interactive-responses.ts — Raw capture of inbound Flow/button responses (whatsapp_interactive_responses)
src/lib/rsvp/niyaz-interactive.ts        — Phase 2 decode: interactive response → niyaz_rsvp via recordNiyazDayRsvp (real + guest overflow, reconciled); then sendNiyazConfirmation sends the day's confirmation template back to the responder (mumin_name + rsvp_status, change-button reopens the Flow)
src/lib/feedback/record.ts               — Append-only feedback capture (area→department tagged)
src/lib/whatsapp/audience.ts             — Send-console audience resolution + free/paid window split + roster-by-phone enrichment (resolveRosterByPhone) + Niyaz reach segments (segmentCounts, segment_* audiences)
src/lib/whatsapp/audience-filter.ts      — Custom-audience rule engine (FIELD_CATALOG, evaluate/runFilter); behavioral fields (Engagement / AI tool usage / Template history) attached in loadRoster() from the phone_message_stats / phone_tool_usage / phone_template_sends views; `set` type = recency-windowed multiselect
src/lib/agent/tool-names.ts              — FILTERABLE_AGENT_TOOLS: curated mumineen-facing agent tools surfaced in the "AI tool usage" audience filter
src/components/admin/RecentSetValueEditor.tsx — Custom rqb value editor for `set` fields (multiselect + "within last N hours")
src/components/admin/AudienceFilterBuilder.tsx — Reusable react-querybuilder custom-audience builder (survey composer custom filters, mixed AND/OR + NOT)
src/components/admin/surveys/AnalyticsTab.tsx — Feedback analytics dashboard (filterable aggregates + AI comment analysis)
src/lib/whatsapp/audience-csv.ts         — Parse an uploaded audience CSV (export/failures format) into broadcast recipients (csv_upload)
src/lib/whatsapp/broadcast.ts            — Throttled template broadcast engine (queue + drain; drainUntilEmpty + failure categorization); persists audience toggles (window_filter/hours, selected_user_ids)
src/lib/whatsapp/phone.ts                — Shared normalizePhone (leaf module; re-exported from audience.ts)
src/lib/whatsapp/undeliverable.ts        — Undeliverable-number suppression: record 131026 fails, threshold-based suppress, suppressedPhones filter, list/clear
src/app/api/admin/whatsapp/undeliverable/route.ts — GET list + DELETE un-flag suppressed numbers (admin/leadership)
src/app/api/admin/templates/drain/route.ts  — Manual "Send pending" — bounded drain trigger (admin/leadership)
src/app/api/admin/templates/broadcasts/[id]/failures/route.ts — Per-recipient broadcast failure list (JSON/CSV, admin/leadership)
src/app/api/admin/templates/broadcasts/[id]/recipients/route.ts — Full broadcast recipient list, every status (JSON/CSV, admin/leadership)
src/lib/digest/run.ts                    — Nightly department digest: aggregate→AI→store→distribute
src/app/api/cron/department-digest/route.ts — Department digest runner endpoint (manual/admin trigger; cron schedule currently paused)
src/app/api/cron/broadcast-drain/route.ts   — Template broadcast drain cron (every minute)
src/app/api/cron/escalation-grouping/route.ts — Trigger B cron (hourly): cluster ungrouped escalations → promote shared issues (clusterUngroupedEscalations)
src/app/webinars/page.tsx                — Public webinars page: ITS gate + video card grid + modal player
src/lib/webinars/youtube.ts              — YouTube ID / thumbnail / embed URL helpers (unit-tested)
```

## Quick Reference: Adding a New Feature

1. Read this index.
2. Read the doc for the relevant feature area.
3. Read [contributing.md](./contributing.md) for file and doc conventions.  Then when building always work API first.
4. Add or update the matching doc when your feature is done.
5. Update [openapi.yaml](./openapi.yaml) whenever an API route changes.
