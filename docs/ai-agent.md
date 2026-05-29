# AI Agent

## Overview

The agent is a single-turn OpenAI chat completion loop with optional tool-calling.  
Source: `src/lib/agent/run-agent.ts`

## Flow

```
runAgent(user, phoneE164, message)
    │
    ├─ retrieveSiteContext(message)     → prepend RAG content to system prompt
    │
    ├─ First completion (tools enabled)
    │       if tool_calls present → executeTool() for each
    │       push tool results to message history
    │
    └─ Second completion (no tools)    → final reply string
```

If no tool calls are made, the first completion's reply is returned directly.

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

Default model: `gpt-4.1-mini`  
Override via `OPENAI_MODEL` environment variable.

The OpenAI client is a singleton initialized on first use (`getOpenAIClient()`).

## Tools

All tools are defined in `src/lib/agent/tools.ts`.

### Public Tools (any role)

| Tool | Description |
|------|-------------|
| `get_event_schedule` | Ashara Mubarak 1447H schedule |
| `get_parking_info` | Parking guidance |
| `get_directions` | Venue directions |
| `get_faq_answer` | FAQ answers |
| `get_lost_found_info` | Lost and found guidance |

### Committee Tools (role: `committee` or `admin`)

| Tool | Description |
|------|-------------|
| `get_volunteer_assignment` | Volunteer assignment lookup |
| `lookup_committee_contact` | Internal committee directory |
| `update_volunteer_status` | Update volunteer status |
| `create_internal_note` | Create internal note |

### Current Status

All tools currently return placeholder `"not_published"` or `"not_connected"` responses.  
They are wired and permission-gated but not yet connected to live data sources.  
When integrating real data, update `runTool()` in `tools.ts` for the relevant case.

## Tool Execution

1. `canUseTool(user, toolName)` — checks role and active status (see [permissions.md](./permissions.md)).
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
