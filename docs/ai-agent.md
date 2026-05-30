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

Public event tools still return placeholder `"not_published"` or `"not_connected"` responses where the source system is not connected. Task tools are wired to the internal task APIs and are permission-gated by account role and department role.

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
