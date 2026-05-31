# Transcript Parser

## Overview

The transcript parser is an AI-powered service that extracts actionable project management events from WhatsApp group conversation exports.

## Usage

```typescript
import { parseTranscript } from "@/lib/transcripts/parser";

const result = await parseTranscript(rawTextContent);
// result.group_name — extracted group name
// result.last_message_at — timestamp of last message
// result.events — array of parsed actionable events
```

## How It Works

1. **Chunking**: If the transcript exceeds 24,000 characters, it's split on WhatsApp date boundaries, including bracketed iOS exports like `[5/29/26, 10:17:37 AM] Sender: message`
2. **Prompt Configuration**: The fixed parser prompt is combined with department-specific flexible rules from `department_prompt_config`
3. **AI Extraction**: Each chunk is sent to OpenAI with a structured extraction prompt
4. **Review Matching**: Parsed events are compared against existing department milestones, tasks, and issues to classify each proposal as `create` or `update`
5. **Fallback Extraction**: If AI parsing returns no usable events or the OpenAI client is unavailable, a deterministic parser extracts obvious action items, issues, milestones, and added members from the transcript so the review screen is not blank
6. **Filtering**: Only AI events with confidence >= 0.5 are returned, and detected members already known by display name or transcript alias are filtered out
7. **Response Format**: Uses `response_format: { type: "json_object" }` for reliable JSON output

## Event Types

| Type | Description |
|------|-------------|
| `task_created` | A new task or action item was assigned |
| `task_updated` | An existing task received a status update |
| `task_completed` | A task was marked as done |
| `milestone_created` | A major deliverable, readiness checkpoint, budget line, or project phase was identified |
| `milestone_updated` | An existing milestone received a progress, budget, status, or decision update |
| `issue_created` | A blocker, risk, open decision, bug, capacity concern, or dependency was identified |
| `issue_updated` | An existing issue received new status or context |
| `issue_resolved` | An issue was resolved or no longer blocking |
| `decision` | A decision was made that may require action |
| `info` | Informational update relevant to project management |

## Parsed Event Structure

```typescript
type ParsedEvent = {
  event_type:
    | "task_created" | "task_updated" | "task_completed"
    | "milestone_created" | "milestone_updated"
    | "issue_created" | "issue_updated" | "issue_resolved"
    | "decision" | "info";
  item_type: "task" | "issue" | "milestone";
  sender_alias: string | null;
  message_timestamp: string | null;
  message_text: string | null;
  ai_summary: string | null;
  task_title: string | null;
  milestone_title: string | null;
  assigned_to_alias: string | null;
  priority: "low" | "medium" | "high";
  temp_milestone_id: string | null; // links new tasks to new milestones before DB IDs exist
  review_action: "create" | "update";
  review_kind: "task" | "issue" | "milestone";
  target_id: string | null;
  target_title: string | null;
  target_status: string | null;
};
```

The parser requests an OpenAI `extract_project_events` function call instead of relying on free-form JSON. Raw function-call responses are stored in `transcript_function_calls` for debugging. Member auto-detection is intentionally disabled; friendly transcript names are returned as `assigned_to_alias` on task/issue proposals so the reviewer can map them to system users.

When the model creates a new milestone, it assigns a `temp_milestone_id` (e.g. `temp_10001`). New tasks/issues referencing that milestone use the same `temp_milestone_id` in their `milestone_id` field. The parser detects temp references and stores them in the `temp_milestone_id` column. During apply, milestones are processed first so real IDs can replace temp references on child tasks.

## Workflow

1. User uploads a `.txt` file via `/admin/upload` or `POST /api/transcripts/upload`
2. User selects one or more departments; selected departments define the existing milestone/task/issue context sent to the prompt
3. Parser calls `extract_project_events`, stores the function-call audit row, and stores reviewable proposals in `conversation_events`
4. User reviews existing work plus proposed milestone, task, and issue creations/updates in the dashboard
5. User reviews in a unified accordion view: department > milestone > tasks/issues. Existing items are read-only; new/updated proposals have editable fields and checkboxes
6. New milestones with child tasks can be approved at the milestone level (group toggle)
7. User selects events to apply -> `POST /api/transcripts/[id]/apply`
8. Applied events create or update milestones, tasks, and issues. Milestones are created first so temp IDs resolve to real database IDs for child tasks

## Configuration

- **Model**: Uses `AI_MODEL` from `src/lib/ai/model.ts` (`OPENAI_MODEL` env override, default `gpt-4o-mini`)
- **Temperature/token cap**: Uses `PARSE_TEMPERATURE` and `MAX_PARSE_TOKENS` from `src/lib/ai/model.ts`
- **Chunk size**: 24,000 characters maximum per API call
- **Temp milestone IDs**: New milestones get `temp_10001`, `temp_10002`, etc. for cross-referencing
- **Prompt rules**: Fixed WhatsApp and meeting prompts live in `src/lib/transcripts/prompts.ts` and appear in the locked dashboard preview. Department-specific defaults also live there and vary by transcript type; saved department overrides are managed via `GET/PUT /api/departments/[id]/prompt-config`.

## Testing

Tests mock the OpenAI client to verify:
- Structured response parsing
- Group name and timestamp extraction
- Temp milestone ID linking
