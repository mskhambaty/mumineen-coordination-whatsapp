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

1. **Chunking**: If the transcript exceeds 24,000 characters, it's split on date boundaries to stay within token limits
2. **Prompt Configuration**: The fixed parser prompt is combined with department-specific flexible rules from `department_prompt_config`
3. **AI Extraction**: Each chunk is sent to OpenAI with a structured extraction prompt
4. **Review Matching**: Parsed events are compared against existing department milestones, tasks, and issues to classify each proposal as `create` or `update`
5. **Filtering**: Only events with confidence >= 0.5 are returned, and detected members already known by display name or transcript alias are filtered out
6. **Response Format**: Uses `response_format: { type: "json_object" }` for reliable JSON output

## Event Types

| Type | Description |
|------|-------------|
| `task_created` | A new task or action item was assigned |
| `task_updated` | An existing task received a status update |
| `task_completed` | A task was marked as done |
| `decision` | A decision was made that may require action |
| `info` | Informational update relevant to project management |

## Parsed Event Structure

```typescript
type ParsedEvent = {
  event_type: "task_created" | "task_updated" | "task_completed" | "decision" | "info";
  sender_alias: string | null;
  message_timestamp: string | null;
  message_text: string | null;
  ai_summary: string | null;
  task_title: string | null;
  assigned_to_alias: string | null;
  priority: "low" | "medium" | "high";
  confidence: number; // 0.0 to 1.0
  review_action: "create" | "update";
  review_kind: "task" | "issue" | "milestone";
  target_id: string | null;
  target_title: string | null;
  target_status: string | null;
};
```

The upload API also returns `new_members: { alias: string; context: string }[]`, filtered to aliases that are not currently known in `whatsapp_users.display_name` or `whatsapp_users.transcript_aliases`.

## Workflow

1. User uploads a `.txt` file via `/admin/upload` or `POST /api/transcripts/upload`
2. Parser extracts events, references existing department items, and stores reviewable proposals in `conversation_events`
3. User reviews proposed milestone, task, and issue creations/updates in the dashboard (high confidence pre-selected)
4. User can edit priority and assignee alias before applying
5. User can approve detected new members via `POST /api/users/bulk-create`
6. User selects events to apply → `POST /api/transcripts/[id]/apply`
7. Applied events create or update milestones, tasks, and issues

## Configuration

- **Model**: Uses `AI_MODEL` from `src/lib/ai/model.ts` (`OPENAI_MODEL` env override, default `gpt-4o-mini`)
- **Temperature/token cap**: Uses `PARSE_TEMPERATURE` and `MAX_PARSE_TOKENS` from `src/lib/ai/model.ts`
- **Chunk size**: 24,000 characters maximum per API call
- **Confidence threshold**: 0.5 minimum for inclusion in results
- **Prompt rules**: Fixed prompt is in `src/lib/transcripts/prompts.ts`; department flexible prompts are saved via `GET/PUT /api/departments/[id]/prompt-config`

## Testing

Tests mock the OpenAI client to verify:
- Structured response parsing
- Confidence filtering (events below 0.5 excluded)
- Group name and timestamp extraction
