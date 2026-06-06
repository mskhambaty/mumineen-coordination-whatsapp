<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Contributor Rules

> This file is the single source of truth for how we build in this repo. It is read by
> Claude Code (via `CLAUDE.md`), Cursor, and GitHub Copilot (via `.github/copilot-instructions.md`).
> Keep rules here; do not duplicate them elsewhere.
>
> This is a community/mosque service for real mumineen. **Treat "don't break the running
> service" and "don't leak personal data" as the top two priorities** — above shipping fast.

## 1. Read the docs index first

**Before writing or modifying any code, read [`docs/index.md`](./docs/index.md).** It tells you
what exists, where it lives, and which feature doc to consult. Then read the specific feature
doc for the area you're touching.

## 2. API-first

Every data access or action MUST go through a `src/app/api/**` route handler. No page,
component, or server action queries the database directly. Design the endpoint before the UI.

The API contract lives in [`docs/openapi.yaml`](./docs/openapi.yaml). Update it for **every**
API route addition or behavior change (parameters, request body, responses, auth, schemas).

## 3. One place for the LLM

All OpenAI calls MUST import `getAIClient()` and model/limit constants from
[`src/lib/ai/model.ts`](./src/lib/ai/model.ts) (`AI_MODEL`, `AGENT_TEMPERATURE`,
`MAX_AGENT_TOKENS`, …). Never hardcode model names or token limits anywhere else.

## 4. Docs ship with the code

A change isn't done until its docs are updated. After implementing a feature:

- Update the relevant feature doc in `docs/`.
- Update [`docs/index.md`](./docs/index.md) (document map + key file locations) if you add files or docs.
- Update [`docs/openapi.yaml`](./docs/openapi.yaml) if an API route changed.
- Update [`docs/architecture.md`](./docs/architecture.md) if the change affects system flow.

## 5. Security & privacy

This app handles personal data for real people. These rules are not optional.

- **Validate every boundary.** Parse all inbound webhook/API input with **Zod** (already a
  dependency) before using it. Never trust the shape of an incoming request.
- **AuthZ on every route.** Every `src/app/api/**` handler must resolve the caller and check
  their permission via [`src/lib/permissions.ts`](./src/lib/permissions.ts) (`canUseTool`,
  `canWriteTasks`, `canUseTaskTool`). No route is implicitly public — if it's meant to be
  public, say so explicitly in the handler and the doc.
- **What counts as PII here:** phone numbers, email addresses, **ITS numbers**, and WhatsApp
  **message content**. Names and home addresses are sensitive too.
- **PII belongs in the database, not in logs.** Storing message content, phone numbers, etc.
  in Supabase tables is correct and expected — that's the system of record our cron jobs and
  analysis read from (it's RLS-protected and accessed only through `src/app/api/**`). The rule
  is about data *escaping* that boundary.
- **Never log PII.** Do not put phone numbers, emails, ITS numbers, or message bodies in
  `console.log`, error messages, thrown errors, or third-party telemetry (Vercel logs, Sentry,
  etc.). Log an opaque id (e.g. a DB row id) instead.
- **Secrets** come only from env via `requireEnv()` / `optionalEnv()` — never hardcoded, never
  sent to the client, never logged.
- **RLS is mandatory.** Enable Row Level Security on every new table.
- **Internal data stays internal.** Never expose committee/host-family lists, contacts, or
  other internal records to `visitor`-role users or to the public agent.

## 6. AI-agent guardrails

The agent talks to the public, so it gets extra rules.

- **Keep it bounded.** The agent runs a single, bounded tool-call round with
  `MAX_AGENT_TOKENS` capping output. If you ever add multi-step / looping tool calls, add an
  explicit max-iterations cap — never an unbounded model loop.
- **Minimize PII sent to the model.** Don't pass phone numbers, emails, or ITS numbers into a
  prompt unless the feature genuinely needs them; prefer ids/handles.
- **The model never bypasses permissions.** Tool execution must still go through `canUseTool` —
  do not rely on the prompt to keep the model in its lane.
- **Prompt changes are code changes.** Edits to the system prompt / `ALWAYS_ON_RULES` in
  `src/lib/agent/run-agent.ts` should be validated against the Ollama A/B page
  ([`docs/ollama-ab-testing.md`](./docs/ollama-ab-testing.md)) before shipping.
- **Sourced answers only.** The agent must answer from tool results / verified context, never
  fabricate event specifics (hotels, schedules, contacts).

## 7. Testing

We don't have senior reviewers gating every change, so tests are the safety net. Lean on them.

- **Every bug fix ships with a regression test** that fails before the fix and passes after.
- **New API routes and agent tools** get at least a happy-path test plus a
  permission-denied / unauthorized test.
- **Never merge with failing or skipped tests.** If a test is wrong, fix it — don't delete or
  `.skip` it to go green.

## 8. Code conventions

- **TypeScript strict** — no `any` unless genuinely unavoidable.
- **Path aliases** — use `@/lib/...` / `@/app/...`, never relative `../../` imports.
- **Server-only code** stays in `src/lib/` and `src/app/api/`; nothing secret-adjacent reaches a client component.
- New env vars go in `.env.example` and [`docs/environment.md`](./docs/environment.md).
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `chore:`.

## 9. Checks before merge

```bash
npm run lint     # ESLint
npm run test     # Vitest unit tests
npm run build    # Next.js production build
```

All three must pass.

## Step-by-step recipes

For detailed, scenario-specific steps (adding a route, a tool, a table, an env var, a new doc),
see **[`docs/contributing.md`](./docs/contributing.md)**.
