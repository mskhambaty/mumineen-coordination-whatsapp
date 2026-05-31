# Database

## Overview

Supabase (Postgres) is the only data store.  
The server always uses the service role key (`SUPABASE_SERVICE_ROLE_KEY`).  
RLS is enabled on all tables but bypassed by the service role.

## Applying Migrations

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Migration files live in `supabase/migrations/`.  
Always create a new timestamped file; never edit an already-applied migration.

## Tables

### `whatsapp_users`

Stores every person who has ever messaged the bot.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, auto-generated |
| `phone_e164` | text | Unique, e.g. `+13125551212` |
| `display_name` | text | WhatsApp profile name (nullable) |
| `role` | text | `visitor` \| `committee` \| `admin` (default: `visitor`) |
| `status` | text | `active` \| `inactive` (default: `active`) |
| `email` | text | Portal email address (nullable) |
| `email_digest` | boolean | Daily task digest preference, default `true` |
| `jamaat` | text | Jamaat affiliation (nullable) |
| `city` | text | City (nullable) |
| `notes` | text | Free-form admin notes (nullable) |
| `created_at` | timestamptz | Auto |
| `updated_at` | timestamptz | Auto-updated by trigger |

### `messages`

Every inbound and outbound message.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `phone_e164` | text | Sender/recipient |
| `direction` | text | `inbound` \| `outbound` |
| `whatsapp_message_id` | text | Unique — used for deduplication |
| `body` | text | Message text |
| `message_type` | text | e.g. `text`, `button`, `interactive` |
| `raw_payload` | jsonb | Full Meta payload |
| `created_at` | timestamptz | Auto |

Indexes: `(phone_e164, created_at desc)`, `(direction, created_at desc)`

### `conversation_sessions`

One row per phone number; upserted on every message.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `phone_e164` | text | Unique |
| `user_id` | uuid | FK → `whatsapp_users.id` (nullable) |
| `current_intent` | text | Last detected intent (nullable, not yet used) |
| `state` | jsonb | Arbitrary session state (default: `{}`) |
| `handling_mode` | text | `ai` \| `manual` (default: `ai`). `manual` pauses the agent so admins reply by hand from the Lead Inbox |
| `handling_mode_at` | timestamptz | When the handling mode last changed (nullable) |
| `handling_mode_by` | uuid | FK → `whatsapp_users.id` (nullable on delete) — admin who changed the mode |
| `escalation_status` | text | `none` \| `pending` \| `resolved` (default `none`). `pending` = shown in the Escalations tab. Orthogonal to `handling_mode` — the AI keeps replying |
| `escalation_reason` | text | Why the conversation was escalated (nullable) |
| `escalation_priority` | text | `normal` \| `urgent` (default `normal`) |
| `escalation_category` | text | Routing tag, e.g. `emergency`, `transport`, `accommodation` (nullable) |
| `escalated_at` | timestamptz | When it was last escalated (nullable) |
| `escalation_source` | text | `ai` \| `rule` \| `manual` (nullable) |
| `last_message_at` | timestamptz | Updated each exchange |
| `created_at` | timestamptz | Auto |

Indexes: `(handling_mode)`, `(last_message_at desc)`, `(escalation_status)`.

### `escalation_support_members`

Membership in this table **is** the `escalation/support` role (see [escalation.md](./escalation.md)).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | Unique FK → `whatsapp_users.id` (cascade delete) |
| `created_at` | timestamptz | Auto |

### `escalation_oncall_hours`

Weekly-recurring on-call windows, evaluated in `America/Chicago`. Only on-call members are
alerted about escalations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `member_id` | uuid | FK → `escalation_support_members.id` (cascade delete) |
| `day_of_week` | smallint | 0–6 (Sun–Sat) |
| `start_time` | time | Local start (America/Chicago) |
| `end_time` | time | Local end |
| `created_at` | timestamptz | Auto |

Index: `(member_id)`. Multiple rows per member (multiple ranges per day).

### `committee_permissions`

Fine-grained permission keys per user (reserved for future use).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `whatsapp_users.id` (cascade delete) |
| `permission_key` | text | Permission string |
| `created_at` | timestamptz | Auto |

Unique constraint: `(user_id, permission_key)`

### `tool_audit_logs`

Immutable log of every tool call.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `whatsapp_users.id` (nullable on delete) |
| `phone_e164` | text | Redundant copy for easier queries |
| `tool_name` | text | Tool that was called |
| `arguments` | jsonb | Arguments passed to the tool |
| `allowed` | boolean | Whether the call was authorized |
| `result_summary` | text | First 500 chars of the result |
| `created_at` | timestamptz | Auto |

Index: `(user_id, created_at desc)`

### `departments`

Coordination departments and committees.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `name` | text | Unique department name |
| `created_at` | timestamptz | Auto |

### `department_members`

Many-to-many membership table for users across departments.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `department_id` | uuid | FK → `departments.id` |
| `user_id` | uuid | FK → `whatsapp_users.id` |
| `dept_role` | text | `hod` \| `pm` \| `member` |
| `is_active` | boolean | Membership visibility flag |
| `created_at` | timestamptz | Auto |

Unique constraint: `(department_id, user_id)`

### `tasks`

Project-management tickets used by the WhatsApp agent and admin portal.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `department_id` | uuid | FK → `departments.id` |
| `title` | text | Required |
| `description` | text | Nullable |
| `status` | text | `open` \| `in_progress` \| `blocked` \| `complete` |
| `priority` | text | `low` \| `medium` \| `high`, default `medium` |
| `archived` | boolean | Soft-delete flag, default `false` |
| `item_type` | text | `task` \| `issue` (default `task`) |
| `origin` | text | `external` \| `internal` (default `internal`). `external` = issues raised from the inbox via `create_issue` |
| `assigned_to` | uuid | FK → `whatsapp_users.id` |
| `created_by` | uuid | FK → `whatsapp_users.id` |
| `source` | text | `transcript` \| `whatsapp_agent` \| `manual` |
| `due_date` | date | Nullable |
| `created_at` | timestamptz | Auto |
| `updated_at` | timestamptz | Auto-updated by trigger |

Indexes: `department_id`, `status`, `assigned_to`, `priority`, `archived`, and `(department_id, status, priority desc)`.

### `department_prompt_config`

Department-specific transcript parser rules.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `department_id` | uuid | Unique FK → `departments.id` |
| `flexible_prompt` | text | Editable department rules |
| `updated_by` | uuid | FK → `whatsapp_users.id` |
| `updated_at` | timestamptz | Auto-updated by trigger |

### `conversation_uploads`

Raw uploaded WhatsApp exports and parser metadata.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `department_id` | uuid | FK → `departments.id` |
| `uploaded_by` | uuid | FK → `whatsapp_users.id` |
| `filename` | text | Original filename |
| `group_name` | text | Parsed group name |
| `raw_content` | text | Uploaded transcript content |
| `parsed_at` | timestamptz | Parser run timestamp |
| `last_message_at` | timestamptz | Parsed latest message timestamp |
| `parsed_new_members` | jsonb | New member aliases detected by the parser |
| `created_at` | timestamptz | Auto |

### `conversation_events`

Parsed actionable transcript events that can be reviewed and applied as tasks.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `upload_id` | uuid | FK → `conversation_uploads.id` |
| `department_id` | uuid | FK → `departments.id` |
| `event_type` | text | `task_created` \| `task_updated` \| `task_completed` \| `decision` \| `info` |
| `task_id` | uuid | FK → `tasks.id` after applying |
| `sender_alias` | text | Transcript sender |
| `message_text` | text | Original message text |
| `message_timestamp` | timestamptz | Parsed message timestamp |
| `ai_summary` | text | Parser summary |
| `task_title` | text | Parser task title |
| `assigned_to_alias` | text | Parser assignee alias |
| `priority` | text | `low` \| `medium` \| `high` |
| `confidence` | float | Parser confidence |
| `applied` | boolean | Whether event has been applied |
| `created_at` | timestamptz | Auto |

### `site_content`

Scraped and embedded chunks from the official site (RAG source).

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial | PK |
| `page_url` | text | Source URL |
| `page_title` | text | HTML `<title>` |
| `section` | text | Heading slug |
| `content` | text | Heading + paragraph text (max 1500 chars) |
| `embedding` | vector(1536) | `text-embedding-3-small` output |
| `scraped_at` | timestamptz | When the row was inserted |
| `is_current` | boolean | `false` for rows replaced by latest scrape |

Requires the `pgvector` extension (`vector` schema).  
IVFFlat index on `embedding` for fast cosine similarity search.

## Supabase RPC Function

`match_site_content(query_embedding, match_threshold, match_count)` — vector similarity search.  
Source: `supabase/migrations/20260529134501_match_site_content.sql`

## Migration Conventions

- One logical change per migration file.
- File name: `YYYYMMDDHHMMSS_short_description.sql`
- Use `create table if not exists` and `create index if not exists` for idempotency where possible.
- Never drop or alter columns in a way that loses data without a data migration plan.
