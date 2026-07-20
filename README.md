# Mumineen Coordination — WhatsApp AI Assistant

A WhatsApp-first coordination platform built for **Anjuman e Saifee Chicago** to run Ashara
Mubaraka. A mumin texts a registered WhatsApp number → a Meta webhook fires → an AI agent
answers in context and can take real actions (RSVPs, lost & found, escalations, and more).
A web admin portal sits on top for committees to manage everything.

This repo is **built to be forked and reused by other Jamaats.** It's organized as a set of
mostly-independent modules so you can adopt the whole thing or lift out just the pieces you
need. This README maps each module to the code that implements it and tells you how to reuse it.

> A small volunteer team built the first working version in ~2 weeks. The point of this README
> is to let your Jamaat do the same — or faster — by starting from what already works.

---

## The core idea: an agent is **AI + software**

The most important lesson from this project: a useful AI assistant is **not just a model**. It's
a model wired into real software — a database, permissioned APIs, and domain workflows. The AI is
the brain; the software is the body. If you want to build something like this, you build both.

- **AI** decides what the user wants and which action to take.
- **Software** actually does it, safely, against real data, with permissions enforced in code
  (never left to the model — see `src/lib/permissions.ts`).

You don't need a frontier model for most of this. We ran on a small, inexpensive model
(GPT‑4.1‑mini class) with excellent results, and included a model A/B testing page to verify
prompt/model changes. **Reserve frontier models for frontier problems.**

---

## High-level architecture

```
WhatsApp user
     │  (text / button reply)
     ▼
Meta WhatsApp Cloud API ──webhook──► /api/whatsapp/webhook   (parse, dedup, store)
                                            │
                                            ▼
                                     AI Agent (src/lib/agent)
                                     • system prompt + RAG context
                                     • bounded, permissioned tool calls
                                            │
                        ┌───────────────────┼────────────────────┐
                        ▼                    ▼                    ▼
                  Domain tools         Supabase (Postgres)   Meta Graph API
              (RSVP, lost&found,       system of record        (outbound reply)
               escalation, etc.)        + RLS on every table

Admin portal (/admin/**) ──► API routes (/api/**) ──► Supabase
Cron jobs (/api/cron/**) ──► nightly digests, broadcast draining
```

**Design rules the whole codebase follows** (see [`AGENTS.md`](./AGENTS.md)):

- **API-first.** No page or component touches the database directly. Every data access goes
  through a `src/app/api/**` route handler. The contract lives in
  [`docs/openapi.yaml`](./docs/openapi.yaml).
- **AuthZ on every route.** Every handler resolves the caller and checks permissions via
  [`src/lib/permissions.ts`](./src/lib/permissions.ts).
- **One place for the LLM.** All model calls import from
  [`src/lib/ai/model.ts`](./src/lib/ai/model.ts) — no hardcoded model names or token limits.
- **RLS is mandatory** on every table; PII never goes to logs.
- **Docs ship with the code.** Start at [`docs/index.md`](./docs/index.md).

### Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) |
| Hosting / CI | Vercel (deploy on git push) |
| Database / Auth | Supabase (Postgres + Row Level Security) |
| Messaging | Meta WhatsApp Cloud API + Graph API |
| AI | OpenAI (small model by default); Ollama for A/B testing |
| Email | Postmark |
| Validation | Zod on every boundary |

---

## Modules — what exists and how to reuse it

Each module below is described with **what it does**, **where the code lives**, and **how to
adopt it partially or fully**. Read the linked feature doc in [`docs/`](./docs/index.md) before
modifying an area.

### 1. Foundation & the conversational core *(start here)*

The platform every other module plugs into. If you fork nothing else, fork this.

| Piece | Code | Doc |
|---|---|---|
| Meta webhook (inbound/outbound, dedup, signature verify) | `src/app/api/whatsapp/webhook/route.ts`, `src/lib/meta/whatsapp.ts`, `src/lib/whatsapp/parser.ts` | [whatsapp-webhook.md](./docs/whatsapp-webhook.md) |
| AI agent (prompt, bounded tool-calling loop) | `src/lib/agent/run-agent.ts`, `src/lib/agent/tools.ts` | [ai-agent.md](./docs/ai-agent.md) |
| Central model/client config | `src/lib/ai/model.ts` | — |
| Permissions & tool access | `src/lib/permissions.ts` | [permissions.md](./docs/permissions.md) |
| Knowledge / RAG (embeddings + vector retrieval) | `src/lib/knowledge/index-content.ts`, `src/lib/scraper/retrieve-site-context.ts` | [site-scraper.md](./docs/site-scraper.md) |
| Supabase operations | `src/lib/supabase/server.ts`, `supabase/migrations/` | [database.md](./docs/database.md) |

**Reuse:** Take this whole layer as your starting skeleton. To make the agent do *your* Jamaat's
work, add tools in `src/lib/agent/tools.ts`, gate them in `src/lib/permissions.ts`, and feed your
own content into the knowledge base via `src/lib/knowledge/index-content.ts`.

### 2. Event-specific functionality *(mostly plain software — adopt à la carte)*

Independent domain features. Each is self-contained enough to keep or drop.

| Module | What it does | Code | Doc |
|---|---|---|---|
| Registration & roster | ITS registration + spreadsheet roster import | `src/app/register/`, `src/app/admin/registration/`, `src/lib/mumineen/`, `public/templates/mumineen-roster-template.xlsx` | [admin-dashboard.md](./docs/admin-dashboard.md) |
| Accommodations matching | Host↔guest matching, XLSX import, capacity rollups | `src/lib/accommodations/{import,rollups,matching}.ts`, `src/app/admin/accommodations/` | [accommodations-matching.md](./docs/plans/accommodations-matching.md) |
| Meal RSVP / Niyaz | Per-mumin RSVP grids, family cascade, tallies | `src/lib/rsvp/`, `src/app/api/rsvp/`, `src/app/admin/niyaz/` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Lost & found | Agent intake, auto-escalation, portal | `src/app/api/lost-found/`, `src/lib/lost-found/reporter.ts`, `src/app/admin/lost-found/` | [lost-found.md](./docs/lost-found.md) |
| Task management | Committee task tracking + agent tools | `src/app/api/tasks/`, `src/app/admin/tasks/` | [task-management.md](./docs/task-management.md) |
| Webinars | Public ITS-gated video page | `src/app/webinars/`, `src/lib/webinars/youtube.ts` | [webinars.md](./docs/webinars.md) |
| Relay updates | Public updates feed + authoring UI | `src/app/api/relay-updates/`, `src/app/admin/relay-updates/` | [relay-updates.md](./docs/relay-updates.md) |

**Reuse:** These are the easiest to cherry-pick. Each has its own API routes, admin page, and
migration(s). Copy the module's `src/lib/**`, its `src/app/api/**` routes, its `src/app/admin/**`
page, and the matching migration; wire the agent tool if the feature is user-facing over WhatsApp.

### 3. Religious content — Waaz Talaqqi & meaning of words

Community-specific content model for daily majlis content and word meanings.

| Code | Doc |
|---|---|
| `src/lib/knowledge/religious-topics.ts`, `src/app/admin/ashara/`, `src/app/admin/religious/` | [ashara-religious-content.md](./docs/ashara-religious-content.md) |

**Reuse:** Adopt the per-majlis content model and translation/lookup flow, swap in your own
content. Independent of the logistics modules.

### 4. Conversation analysis *(the most AI-native part)*

Turns unstructured WhatsApp conversation into structured operations — the thing that's hard to do
with humans or rigid if-then bots. This is where the "agent" earns its keep.

| Piece | Code | Doc |
|---|---|---|
| Escalation & Triage Desk (Kanban, SLA, on-call) | `src/lib/escalation/`, `src/app/api/escalations/`, `src/app/admin/escalation/` | [escalation.md](./docs/escalation.md) |
| AI grouping (messages → tickets) | `src/app/api/admin/issues/suggestions/route.ts`, `src/components/admin/AIGroupingModal.tsx`, `src/lib/escalation/issue-match.ts` | [escalation.md](./docs/escalation.md) |
| Issues CRUD + linking | `src/app/api/admin/issues/**` | [escalation.md](./docs/escalation.md) |
| Nightly department digest + cron | `src/lib/digest/run.ts`, `src/app/api/cron/department-digest/route.ts` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Feedback capture + RSVP follow-ups | `src/lib/feedback/record.ts`, `src/lib/rsvp/niyaz-prompt.ts` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Outbound templates / broadcast (send console) | `src/lib/whatsapp/{send-template,broadcast,audience}.ts`, `src/app/admin/whatsapp-templates/`, `src/app/api/cron/broadcast-drain/route.ts` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Email notifications | `src/lib/email/postmark.ts`, `src/app/api/auth/` | [email.md](./docs/email.md) |

**Reuse:** The escalation → AI-grouping → digest loop is the flagship. It depends on the
foundation (agent + Supabase) but not on the event modules, so you can adopt it on its own to add
"analyze our conversations and open tickets automatically" to any WhatsApp deployment.

### 5. Model testing & tooling

| Piece | Code | Doc |
|---|---|---|
| Ollama A/B model testing page | `src/app/api/ollama/`, `src/app/admin/ollama-test/` | [ollama-ab-testing.md](./docs/ollama-ab-testing.md) |
| WhatsApp transcript parser | `src/app/api/transcripts/` | [transcript-parser.md](./docs/transcript-parser.md) |
| Admin dashboard shell + auth + access control | `src/app/admin/`, `src/lib/admin/`, `src/components/admin/AdminNav.tsx` | [admin-dashboard.md](./docs/admin-dashboard.md), [access-control.md](./docs/access-control.md) |

**Reuse:** Use the A/B page to pick the cheapest model that meets your quality bar before you
ship. The admin shell and access-control matrix are reusable scaffolding for any portal you build.

---

## Fork it for your Jamaat — quick path

1. **Fork the repo** and read [`docs/index.md`](./docs/index.md), then [`AGENTS.md`](./AGENTS.md).
2. **Stand up infrastructure:** create a Vercel project, a Supabase project, and a Meta WhatsApp
   Cloud API app. (Free tiers are enough to start.)
3. **Adopt the foundation** (Module 1). Get an inbound message to produce a reply end-to-end.
4. **Pick your modules.** Keep the event/analysis modules you need; delete the rest along with
   their routes, admin pages, and migrations.
5. **Load your content** into the knowledge base and add your own agent tools.
6. **Set roles.** Mark committee/admin numbers and portal users per
   [`docs/permissions.md`](./docs/permissions.md) and [`docs/access-control.md`](./docs/access-control.md).
7. **Deploy** by pushing to your Vercel-connected branch.

---

## Setup reference

### Environment variables

Set in Vercel (Production + Preview). Full list and aliases in
[`docs/environment.md`](./docs/environment.md).

```text
META_GRAPH_API_VERSION
META_WEBHOOK_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
OPENAI_MODEL
```

Optional: `META_APP_SECRET` — if set, webhook `POST` requests must include a valid
`X-Hub-Signature-256` header. `SUPABASE_SERVICE_ROLE_KEY` must only ever live in a server runtime.

### Webhook

Meta callback URL: `https://<your-vercel-domain>/api/whatsapp/webhook`. Use the same value for
`META_WEBHOOK_VERIFY_TOKEN` in Vercel and in Meta's webhook configuration.

- `GET /api/whatsapp/webhook` — validates Meta's challenge.
- `POST /api/whatsapp/webhook` — parses inbound messages, dedupes by `whatsapp_message_id`,
  stores in/outbound, runs the agent, and sends the reply.

### Supabase

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

RLS is enabled on all tables; the server uses `SUPABASE_SERVICE_ROLE_KEY`. To mark a committee
number:

```sql
update public.whatsapp_users set role = 'committee' where phone_e164 = '+13125551212';
```

### Meta WhatsApp setup

Subscribe the app to the WABA, register the phone number, and send a `hello_world` template test
via the Graph API. See the Graph API calls in `src/lib/meta/whatsapp.ts` and Meta's Cloud API
docs.

### Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Verify the webhook challenge locally:

```bash
curl "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$META_WEBHOOK_VERIFY_TOKEN&hub.challenge=test-challenge"
```

### Testing

```bash
npm run lint
npm run test
npm run build
```

Every bug fix ships with a regression test; new API routes and agent tools get a happy-path plus
a permission-denied test. See [`AGENTS.md`](./AGENTS.md) §7.

---

## Documentation

The full documentation set lives in [`docs/`](./docs/index.md) — always start with the index. Key
docs: [architecture.md](./docs/architecture.md), [database.md](./docs/database.md),
[openapi.yaml](./docs/openapi.yaml), [contributing.md](./docs/contributing.md).

---

## A note for other Jamaats

This was built by volunteers to serve a real community, and it handles real personal data. If you
fork it, keep the two rules that mattered most to us: **don't break the running service**, and
**don't leak personal data**. Enable RLS on every table, keep secrets in server env only, and
never log phone numbers, ITS numbers, emails, or message content.
