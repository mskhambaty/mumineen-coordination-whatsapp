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
(GPT‑4.1‑mini class, `OPENAI_MODEL`) with excellent results, and only reach for a stronger model
(`OPENAI_MODEL_HIGH`) on the few hard tasks that need it. A built-in A/B testing page lets you
verify prompt/model changes before shipping. **Reserve frontier models for frontier problems.**

---

## Where AI actually happens *(the map)*

If you're here to understand **how AI flows through the application**, this is the section. The
LLM is not one magic box at the front — it shows up at ~15 specific, bounded points, each doing a
narrow job. Everything funnels through **one hub** so models, temperatures, and token caps are set
in a single file, never scattered.

### The one hub — [`src/lib/ai/model.ts`](./src/lib/ai/model.ts)

Every AI call in the codebase imports from here. Nothing hardcodes a model name.

| Export | What it is |
|---|---|
| `getAIClient()` | The single OpenAI client factory (server-only). |
| `AI_MODEL` | Cheap default model (`gpt-4o-mini` class) — used for almost everything. |
| `AI_MODEL_HIGH` | Stronger model — used only for heavy **batched** jobs (e.g. nightly mining). |
| `AI_VISION_MODEL` | Multimodal model for image questions. |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` — powers all RAG / semantic search. |
| `AGENT_TEMPERATURE` / `PARSE_TEMPERATURE` / `SUMMARY_TEMPERATURE` | Task-tuned determinism (0.2 / 0.1 / 0.4). |
| `MAX_AGENT_TOKENS` … | Hard output caps that bound cost and runaway generation. |
| `chatParams()`, `isReasoningModel()` | Build request params correctly per model family. |

### 1. Real-time — runs on each inbound WhatsApp message

| Touchpoint | Code | What the model does | Model / settings |
|---|---|---|---|
| **Agent loop** | `src/lib/agent/run-agent.ts` | Reads the message + RAG context, decides a reply, and makes **one bounded round of permissioned tool calls**. The reasoning core. | `AI_MODEL`, temp 0.2, capped tokens |
| **RAG retrieval** | `src/lib/scraper/retrieve-site-context.ts` | Embeds the question and vector-searches curated content so answers are **sourced, not invented**. | embeddings |
| **Ruling guard** | `src/lib/agent/ruling-guard.ts` | A pre-model classifier that catches personal fiqh / halal-haram questions and refuses **before** the model can opine. Safety rail. | `AI_MODEL`, ~8 tokens, temp 0 |
| **Department routing** | `src/lib/departments/classify.ts` | One tiny cached call maps an issue/feedback to the right department from the **live** committee list. | `AI_MODEL`, ~40 tokens, temp 0 |
| **Image questions** | `src/lib/agent/vision.ts` | Answers about a sent image, grounded **only** on that image (isolated from RAG so event context can't bleed in). | `AI_VISION_MODEL` |

### 2. Indexing — turns content into embeddings (so RAG can find it)

| Touchpoint | Code | What the model does |
|---|---|---|
| Knowledge base indexing | `src/lib/knowledge/index-content.ts` | Embeds curated docs/FAQ buckets into `site_content`. |
| Religious topics | `src/lib/knowledge/religious-topics.ts` | Routing/themes over Waaz Talaqqi content. |
| Relay updates | `src/lib/relay-updates/shared.ts` | Embeds public updates so the agent can cite them. |

### 3. Background analysis — cron / admin-triggered, batched

This is the **most AI-native** layer: reading conversations in bulk and producing structure.

| Touchpoint | Code | What the model does | Model |
|---|---|---|---|
| Conversation mining (for digest) | `src/lib/digest/mine-conversations.ts` | Mines 24h of chats for experience feedback — **many conversations per call**. | `AI_MODEL_HIGH` |
| Department digest | `src/lib/digest/run.ts` | Aggregates + writes the nightly per-department summary. | summary preset |
| Issue matching / grouping | `src/lib/escalation/issue-match.ts`, `src/lib/escalation/issue-grouping.ts` | Clusters escalations and matches same-problem reports into one shared issue (Trigger B). | `AI_MODEL` |
| Escalation & issue suggestions | `src/app/api/admin/escalations/[phoneE164]/suggestions/route.ts`, `src/app/api/admin/issues/suggestions/route.ts` | Suggests matching issues + resolution history to a triager. | `AI_MODEL` |
| Conversation-quality scoring | `src/app/api/cron/conversation-quality/route.ts` | Scores/summarizes handled conversations. | summary preset |
| Knowledge-gap analysis | `src/lib/knowledge/analyze-gaps.ts` | Finds questions the KB couldn't answer, to fill later. | `AI_MODEL` |
| Survey comment analysis | `src/app/api/admin/surveys/analytics/ai/route.ts` | Themes + sentiment over free-text survey comments. | summary preset |
| Transcript parsing | `src/lib/transcripts/parser.ts` | Turns a pasted WhatsApp transcript into structured rows. | parse preset |

### 4. Model testing — pick the cheapest model that passes

| Touchpoint | Code | What it does |
|---|---|---|
| Ollama A/B page | `src/app/api/ollama/`, `src/app/admin/ollama-test/` | Runs the same prompt against candidate (incl. open-source) models side by side, so you can verify quality before switching `OPENAI_MODEL`. |

**The pattern to copy:** each AI touchpoint is small, single-purpose, funneled through one config
hub, and wrapped in software that enforces permissions and grounds the output. That's what makes it
reliable enough to point at real people.

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
Cron jobs (/api/cron/**) ──► department digests, broadcast draining, escalation grouping
```

One shared webhook (`/api/whatsapp/webhook`) serves **all** WhatsApp numbers and routes each
delivery to the right account by `metadata.phone_number_id` — so you can run a second (broadcast)
number alongside the primary one without a second endpoint (see `src/lib/whatsapp/accounts.ts`).

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
| Messaging | Meta WhatsApp Cloud API + Graph API (multi-account: primary + broadcast number) |
| AI | OpenAI (small model by default, stronger model on demand); Ollama for A/B testing |
| UI helpers | react-querybuilder (audience filters), react-phone-number-input, xlsx (imports) |
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
| Meta webhook (inbound/outbound, dedup, signature verify) | `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/inbound.ts`, `src/lib/meta/whatsapp.ts`, `src/lib/whatsapp/parser.ts` | [whatsapp-webhook.md](./docs/whatsapp-webhook.md) |
| Multi-account WhatsApp registry (primary + broadcast number) | `src/lib/whatsapp/accounts.ts` | [whatsapp-webhook.md](./docs/whatsapp-webhook.md) |
| AI agent (prompt, bounded tool-calling loop) | `src/lib/agent/run-agent.ts`, `src/lib/agent/tools.ts` | [ai-agent.md](./docs/ai-agent.md) |
| Central model/client config (default + high tier) | `src/lib/ai/model.ts` | — |
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
| Meal RSVP / Niyaz | Per-day events, RSVP grids (by family / by individual), interactive Flow replies + confirmations, tallies & charts | `src/lib/rsvp/`, `src/app/api/rsvp/`, `src/app/api/admin/niyaz/`, `src/app/admin/niyaz/` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Lost & found | Agent intake, auto-escalation, portal CRUD | `src/app/api/lost-found/`, `src/lib/lost-found/reporter.ts`, `src/app/admin/lost-found/` | [lost-found.md](./docs/lost-found.md) |
| Feedback surveys | Question databank, group sampling (fresh-first, once-per-event), tokenized web form, 1–5 sentiment + AI comment analysis | `src/lib/surveys/`, `src/app/admin/surveys/`, `src/app/feedback/s/[token]/`, `src/app/api/feedback-survey/[token]/` | [feedback-surveys.md](./docs/feedback-surveys.md) |
| Knowledge quiz | Bilingual (English / Lisan ud Dawat) quiz, shared link + self-entered ITS, server-side grading, admin leaderboard | `src/lib/quiz/`, `src/app/quiz/[token]/`, `src/app/admin/quiz/`, `src/app/api/quiz/`, `src/app/api/admin/quiz/` | [quiz.md](./docs/quiz.md) |
| Parking passes | Caller-scoped lookup (own family only) + per-color entry guidance; agent tool | `src/app/api/parking/my-passes/`, `src/lib/parking/entry-info.ts` | — |
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
| AI grouping — messages → tickets (on demand) | `src/app/api/admin/issues/suggestions/route.ts`, `src/components/admin/AIGroupingModal.tsx`, `src/lib/escalation/issue-match.ts` | [escalation.md](./docs/escalation.md) |
| Auto issue-promotion (Trigger B, hourly cron) | `src/lib/escalation/issue-grouping.ts`, `src/app/api/cron/escalation-grouping/route.ts` | [escalation.md](./docs/escalation.md) |
| Issues CRUD + linking + per-link lifecycle | `src/app/api/admin/issues/**`, `src/lib/issues/link-status.ts` | [escalation.md](./docs/escalation.md) |
| Department digest (aggregate → AI → distribute) | `src/lib/digest/run.ts`, `src/app/api/cron/department-digest/route.ts` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Feedback capture + RSVP follow-ups | `src/lib/feedback/record.ts`, `src/lib/rsvp/niyaz-interactive.ts` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Outbound templates / broadcast (send console) | `src/lib/whatsapp/{send-template,broadcast,audience}.ts`, `src/app/admin/whatsapp-templates/`, `src/app/api/cron/broadcast-drain/route.ts` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Custom audience filters (behavioral targeting) | `src/lib/whatsapp/audience-filter.ts`, `src/components/admin/AudienceFilterBuilder.tsx` | [meal-rsvp-feedback-digest.md](./docs/meal-rsvp-feedback-digest.md) |
| Undeliverable-number suppression | `src/lib/whatsapp/undeliverable.ts`, `src/app/api/admin/whatsapp/undeliverable/route.ts` | — |
| Email notifications | `src/lib/email/postmark.ts`, `src/app/api/auth/` | [email.md](./docs/email.md) |

**Reuse:** The escalation → AI-grouping → digest loop is the flagship. It depends on the
foundation (agent + Supabase) but not on the event modules, so you can adopt it on its own to add
"analyze our conversations and open tickets automatically" to any WhatsApp deployment. The
send-console + audience-filter stack is reusable on its own for targeted WhatsApp broadcasts.

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
# Core — required
META_GRAPH_API_VERSION
META_WEBHOOK_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
OPENAI_MODEL            # small/cheap default model
OPENAI_MODEL_HIGH       # stronger model, used only where needed

# Optional — second (broadcast) WhatsApp number: same keys with a _BROADCAST suffix
WHATSAPP_ACCESS_TOKEN_BROADCAST
WHATSAPP_PHONE_NUMBER_ID_BROADCAST
WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST
```

Optional: `META_APP_SECRET` — if set, webhook `POST` requests must include a valid
`X-Hub-Signature-256` header. Feature flags such as `SURVEY_SEND_ENABLED` and
`DIGEST_WHATSAPP_ENABLED` gate outbound sends. `SUPABASE_SERVICE_ROLE_KEY` must only ever live in
a server runtime. The **full, authoritative list (with aliases and the `_BROADCAST` account) is in
[`docs/environment.md`](./docs/environment.md)** — start there, not from this excerpt.

### Webhook

Meta callback URL: `https://<your-vercel-domain>/api/whatsapp/webhook`. Use the same value for
`META_WEBHOOK_VERIFY_TOKEN` in Vercel and in Meta's webhook configuration.

- `GET /api/whatsapp/webhook` — validates Meta's challenge.
- `POST /api/whatsapp/webhook` — routes the delivery to the right account by
  `metadata.phone_number_id`, parses inbound text / button / Flow responses, dedupes by
  `whatsapp_message_id`, stores in/outbound, runs the agent, and sends the reply. A single
  endpoint serves every configured number.

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
