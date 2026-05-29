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
2. **AI Extraction**: Each chunk is sent to OpenAI with a structured extraction prompt
3. **Filtering**: Only events with confidence >= 0.5 are returned
4. **Response Format**: Uses `response_format: { type: "json_object" }` for reliable JSON output

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
  confidence: number; // 0.0 to 1.0
};
```

## Workflow

1. User uploads a `.txt` file via `/admin/upload` or `POST /api/transcripts/upload`
2. Parser extracts events and stores them in `conversation_events`
3. User reviews events in the dashboard (high confidence pre-selected)
4. User selects events to apply → `POST /api/transcripts/[id]/apply`
5. Applied events create or update tasks in the `tasks` table

## Configuration

- **Model**: Uses the configured `OPENAI_MODEL` env var (defaults to gpt-4.1-mini)
- **Chunk size**: 24,000 characters maximum per API call
- **Confidence threshold**: 0.5 minimum for inclusion in results

## Testing

Tests mock the OpenAI client to verify:
- Structured response parsing
- Confidence filtering (events below 0.5 excluded)
- Group name and timestamp extraction
