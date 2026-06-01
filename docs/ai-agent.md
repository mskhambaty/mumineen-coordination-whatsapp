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
    ├─ Build messages: [ system prompt (+ site + sender context),
    │                    ...replayed history turns ]
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
- Agent temperature: `AGENT_TEMPERATURE`
- Token cap: `MAX_AGENT_TOKENS`
- OpenAI client: `getAIClient()`

No agent file should instantiate `OpenAI` or hardcode model names directly.

## Tools

All tools are defined in `src/lib/agent/tools.ts`.

### Public Tools (any role)

| Tool | Description |
|------|-------------|
| `get_site_content_faq` | Single public-info tool — looks up schedule, parking, directions, accommodation, registration, lost & found, and general FAQs from the indexed site content (RAG). Consolidates the former five `get_*` tools. |
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

An always-on **Escalation Policy** block is appended to the system prompt in `run-agent.ts`
so it can't be edited away: escalation is a last resort, never on a premature "talk to a
human", and emergencies (lost child/passport, medical, security) escalate immediately as
`urgent`. The hard turn-gate (min. inbound messages, emergency bypass) lives in
`/api/escalations`. On a successful escalation the agent replies with a deterministic
acknowledgment and skips the second completion.

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
