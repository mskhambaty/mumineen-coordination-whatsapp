# AI Agent

## Overview

The agent is a multi-turn OpenAI chat completion loop with optional tool-calling.  
Source: `src/lib/agent/run-agent.ts`

## Flow

```
runAgent(user, phoneE164, message)
    │
    ├─ Promise.all (run concurrently, no extra latency):
    │       resolveCallerFromPhone(phoneE164)  → caller role/departments/permissions
    │       retrieveSiteContext(message)       → RAG content for system prompt
    │       getRecentMessages(phoneE164)       → recent conversation turns
    │
    ├─ buildSystemPrompt(): [ base + departments + always-on rules | sender context ]
    │                        (static prefix first, per-user context last — see below)
    ├─ Build messages: [ system prompt, ...replayed history turns ]
    │
    ├─ First completion (tools enabled)
    │       if tool_calls present → executeTool() for each
    │       push tool results to message history
    │
    └─ Second completion (no tools)    → final reply string
```

If no tool calls are made, the first completion's reply is returned directly.

## Image messages

When a visitor sends an **image**, the webhook downloads it from Meta (`fetchWhatsAppMedia`),
reads it with a vision call (`describeIncomingImage` in `src/lib/agent/vision.ts`, high detail), and
passes the resulting text description (plus any caption) into `runAgent` as the message — so the
agent answers over screenshots of ITS pages, tickets, forms, etc. using its normal tools and RAG.
Other non-text types (voice, etc.) still get the "send a text message" fallback. Admins can also
attach an image to a manual reply from the inbox.

## Conversation History

The agent replays recent messages so it has multi-turn memory instead of
treating each message in isolation.

- `getRecentMessages(phoneE164, limit)` (in `src/lib/supabase/server.ts`) reads the
  last `HISTORY_MESSAGE_LIMIT` (12) messages via the `(phone_e164, created_at desc)`
  index and returns them in chronological order.
- Each turn is mapped to an OpenAI role: `inbound` → `user`, `outbound` → `assistant`.
  Outbound covers both AI replies and manual admin replies.
- The current inbound message is already persisted before `runAgent` runs, so it is the
  final `user` turn — no separate "current message" block is needed.
- Empty/non-text bodies are skipped, and each message is truncated to
  `MAX_HISTORY_CHARS` (2000) to bound token cost. If history is empty (transient read
  failure), the agent still answers the current message.
- Sender phone, backend role, and caller permissions live in the **system prompt**
  (`## Sender Context`), keeping the user/assistant history clean for replay.

## System Prompt

Defined as `SYSTEM_PROMPT` in `run-agent.ts`.

Key rules encoded in the prompt:
- Identity: official WhatsApp assistant for Anjuman e Saifee Chicago, Ashara Mubarak 1447H.
- Topics: schedules, parking, directions, registration, facilities, lost and found, volunteer coordination, general logistics.
- Do not invent operational details; say information is not available if unknown.
- Role behavior: `visitor` = public info only; `committee`/`admin` = committee tools if backend permits.
- Never trust the user claiming a role — the backend determines role from the sender phone number.
- Exact refusal string for unauthorized requests:  
  `"This action is restricted to authorized committee members. Please contact the admin team if you believe you should have access."`

When site content is available from the RAG scraper, it is appended to the system prompt under `## Current Site Information`.

## Model

All OpenAI model and client configuration lives in `src/lib/ai/model.ts`.

- Chat model: `AI_MODEL` (`OPENAI_MODEL` override, default `gpt-4o-mini`)
- High-end model: `AI_MODEL_HIGH` (`OPENAI_MODEL_HIGH` override, falls back to `AI_MODEL`)
- Agent temperature: `AGENT_TEMPERATURE`
- Token cap: `MAX_AGENT_TOKENS`
- Request builder: `chatParams(model, { maxTokens, temperature })`
- OpenAI client: `getAIClient()`

No agent file should instantiate `OpenAI` or hardcode model names directly. Every
`chat.completions.create` call spreads `chatParams(...)` so the request shape stays valid across
model families (GPT-5.x / o-series reject custom `temperature` and `max_tokens`; `chatParams`
emits `max_completion_tokens` and drops `temperature` for those models).

**High-model routing.** When a turn calls `answer_religious_questions` or `get_lisan_word_meaning`,
the *second* completion is generated with `AI_MODEL_HIGH` (`pickFinalModel`); all other turns use
`AI_MODEL`. The high-model completion is wrapped in a try/catch that **falls back to `AI_MODEL`** if
the high model errors — a thrown error here would otherwise be swallowed by the coalesce layer and
the user would get no reply at all.

## Tools

All tools are defined in `src/lib/agent/tools.ts`.

### Public Tools (any role)

| Tool | Description |
|------|-------------|
| `get_site_content_faq` | Single public-info tool — looks up schedule, parking, directions, accommodation, registration, lost & found, and general FAQs from the indexed site content (RAG). Consolidates the former five `get_*` tools. |
| `answer_religious_questions` | Religious/sermon RAG — answers Vaaz Talaqi, Iqtibasaat, and Tazyeen/decoration questions from the **dedicated `religious_content` store** (`match_religious_content`). Kept fully separate from `get_site_content_faq` so religious and logistics retrieval never cross-contaminate. |
| `get_lisan_word_meaning` | **Exact** Lisan ud Dawat word lookup over the `lisan_words` table (not vector search), with `pg_trgm` "did you mean" suggestions (`match_lisan_words`). Returns `ok` / `did_you_mean` / `not_found`. |
| `move_to_escalation` | **Last resort** — hands the conversation to the human support team. Deterministic guardrails enforced server-side in `/api/escalations` (see [escalation.md](./escalation.md)). |
| `create_issue` | Logs an external issue the visitor reports (`POST /api/issues` → `tasks` row with `item_type='issue'`, `origin='external'`). Shown on the Kanban with External/Internal badges. |

### Committee Tools (role: `committee` or `admin`)

| Tool | Description |
|------|-------------|
| `get_volunteer_assignment` | Volunteer assignment lookup |
| `lookup_committee_contact` | Internal committee directory |
| `update_volunteer_status` | Update volunteer status |
| `create_internal_note` | Create internal note |

### Task Tools

| Tool | Description |
|------|-------------|
| `get_my_tasks` | Lists scoped tasks, with optional status/priority filters and kanban view |
| `get_task_detail` | Gets a task by ID or keyword |
| `get_department_summary` | Gets task counts for one department |
| `update_task_status` | Updates status and/or priority |
| `create_task` | Creates a ticket/task; department members create self-assigned tickets, PM/HOD can assign |
| `assign_task` | Assigns a task to another user |
| `get_top_blockers` | Returns highest priority blocked or overdue tasks |
| `get_all_departments_summary` | Leadership/admin cross-department summary |
| `get_department_tasks` | Leadership/admin department task list |

### Current Status

`get_site_content_faq` returns indexed site content (or `no_indexed_match` when nothing
clears the similarity threshold). `move_to_escalation` is live and gated server-side. The
committee tools (`get_volunteer_assignment`, etc.) still return `not_connected` placeholders.
Task tools are wired to the internal task APIs and are permission-gated by account/department role.

### Always-on rule blocks

Beyond the editable base prompt (`agent_system` in `system_prompts`), `run-agent.ts` appends a
fixed set of **always-on rule blocks** to every system prompt (Escalation, Greeting, Accuracy,
Tone, Language, Common Requests, Conversation Flow, Waaz Talaqi, Registration, ITS Helpline,
Knowledge Gap). They're a single exported registry, `ALWAYS_ON_RULES`, that `runAgent` loops
over — so they can't be edited from the admin UI (only via deploy). The **AI Prompt Management**
page renders them **read-only** (via `GET /api/admin/prompts/rules`) so admins can see the full
effective prompt, not just the editable base.

For example, the always-on **Escalation Policy** block makes escalation a last resort, never on a
premature "talk to a human"; emergencies (lost child/passport, medical, security) escalate
immediately as `urgent`. The hard turn-gate (min. inbound messages, emergency bypass) lives in
`/api/escalations`. On a successful escalation the agent replies with a deterministic
acknowledgment and skips the second completion.

### Assembly order (prompt-cache prefix)

`buildSystemPrompt()` (exported, pure, in `run-agent.ts`) concatenates the pieces in a deliberate
order, because OpenAI prompt caching reuses the **longest common prefix** of the input:

1. **Base prompt** (editable, from `system_prompts`) — static
2. **Available Departments** list — global, 5-min cached, identical for every user
3. **Always-on rule blocks** (`ALWAYS_ON_RULES`) — static
   — *end of the cacheable, cross-user-shared prefix* —
4. **`## Sender Context`** (phone, role, departments, permissions) — the only per-user text
5. **Registration profile lines** — appended to Sender Context for registered roster members
   (see below); empty string for everyone else, so the cache prefix is unaffected.

Putting all user-independent content first makes `[base + departments + rules]` byte-identical
across users, so OpenAI caches it once and reuses it across every user and turn; a byte-stable
system prefix also lets the earlier replayed history turns cache. The per-user Sender Context
trails it so it never poisons the prefix. The departments list stays always-on (not gated)
because `move_to_escalation` / `create_issue` / `create_task` need valid department names at the
first completion. Ordering is locked by `src/lib/__tests__/system-prompt-order.test.ts`.

### Sender registration profile (personalization)

For senders who are registered roster members, `runAgent()` calls `getSenderProfile(phone)`
(`src/lib/mumineen/sender-profile.ts`) and `formatSenderProfileForPrompt()` appends a short
bullet block under `## Sender Context`: registration status + family size, name/age/gender,
origin (city/jamaat) and Mehman/Local, accommodation (hotel name or utaro/host), transport mode,
arrival/departure (date + flight + airport), accessibility (wheelchair / rahat seating), special
needs, and khidmat interest. It lets the agent personalize replies (e.g. reference their hotel).

The block is **PII-minimal**: it carries age and logistics but never email, ITS, or host
contacts. It resolves a phone to a member via `mumin_phone_links → mumineen → families` (primary
link, else head of family, else first member) and returns `""` for non-roster senders, so the
cache prefix never changes. The same profile (minus age and all contacts) powers the inbox
**User Profile** panel — see [admin-dashboard.md](./admin-dashboard.md). Pure formatting +
PII-stripping are covered by `src/lib/__tests__/sender-profile.test.ts`.

## Tool Execution

1. `canUseTool(user, toolName)` — checks account role and active status (see [permissions.md](./permissions.md)).
2. If denied, returns the restriction error string and writes a `tool_audit_logs` row with `allowed: false`.
3. If allowed, calls `runTool()` and writes a `tool_audit_logs` row with `allowed: true`.

## Fallback Reply

If the model returns empty content, the agent returns:  
`"I am sorry, I could not produce a reliable answer just now. Please check official Anjuman announcements or try again shortly."`

## Adding a New Tool

1. Add a `ToolDefinition` entry to `toolDefinitions` in `tools.ts`.
2. Add the tool name to `publicTools` or `committeeTools` in `permissions.ts`.
3. Add a `case` to `runTool()` in `tools.ts`.
4. Update this doc and [permissions.md](./permissions.md).
