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
| `user_id` | uuid | FK → `whatsapp_users.id` (cascade delete) |
| `department_id` | uuid | FK → `departments.id` (nullable). The member is an escalation contact for this department; NULL = legacy/global (only used for the "no department determined" case). Unique on `(user_id, department_id)`. |
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

### `knowledge_documents`

Uploaded FAQ/guide documents (CSV, Excel, Word, PDF). Their extracted text is chunked,
embedded, and stored in `site_content` with `page_url = 'knowledge://<id>'` (or in
`religious_content` when `store = 'religious'`), so the agent's `get_site_content_faq`
(or `answer_religious_questions`) grounds on them. Deleting a row also removes those chunks.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `department_id` | uuid | FK → `departments.id` (nullable) — optional labeling; omitted for religious uploads |
| `uploaded_by` | uuid | FK → `whatsapp_users.id` (nullable) |
| `title` | text | Display title (defaults to filename) |
| `filename` | text | Original filename (nullable) |
| `file_type` | text | `csv` \| `excel` \| `word` \| `pdf` \| `faq` (`faq` = created from an approved conversation suggestion) |
| `store` | text | `logistics` (default) \| `religious` — which vector store the chunks land in (`site_content` vs `religious_content`) |
| `status` | text | `processing` \| `indexed` \| `failed` |
| `chunk_count` | integer | Number of vectorized chunks |
| `error` | text | Failure reason (nullable) |
| `created_at` | timestamptz | Auto |

Raw files are not stored — only the extracted/vectorized text (same approach as the hotel sheet).

### `knowledge_suggestions`

Review queue for the **Learn from Conversations** feature (Prompt page). The analyzer
(`src/lib/knowledge/analyze-gaps.ts`) scans recent conversations for knowledge gaps and drafts
Q&A candidates here as `pending`. An admin approves (→ creates a `knowledge_documents` row with
`file_type = 'faq'` and indexes it) or rejects. Reusable by a future cron.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `question` | text | Drafted FAQ question |
| `suggested_answer` | text | Drafted answer (PII-stripped) |
| `category` | text | e.g. `hotels`, `transport` (nullable) |
| `source_phone` | text | Conversation the gap came from (reviewer context, nullable) |
| `source_excerpt` | text | Optional transcript snippet (nullable) |
| `confidence` | numeric | Model confidence 0–1 (nullable) |
| `status` | text | `pending` \| `approved` \| `rejected` |
| `dedup_key` | text | Normalized question; unique among `pending` rows to avoid re-proposing |
| `department_id` | uuid | FK → `departments.id` (nullable) — assigned by the analyzer; approval appends the Q&A to this department's `faq_buckets` entry |
| `knowledge_document_id` | uuid | FK → `knowledge_documents.id` once approved (nullable; legacy — approvals now go to `faq_buckets`) |
| `reviewed_by` | text | Who approved/rejected (nullable) |
| `reviewed_at` | timestamptz | When reviewed (nullable) |
| `created_at` | timestamptz | Auto |

### `faq_buckets`

One editable FAQ document per department (the **FAQ by Department** feature). Saving a bucket
chunks + embeds its `content` into `site_content` with `page_url = 'faqbucket://<department_id>'`,
so the agent retrieves it while it stays organized and editable per department.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `department_id` | uuid | FK → `departments.id` (unique; one bucket per department) |
| `content` | text | Editable Q&A text (entries separated by blank lines) |
| `chunk_count` | integer | Vectorized chunks from the last save |
| `updated_by` | text | Who last saved (nullable) |
| `updated_at` | timestamptz | Auto |
| `created_at` | timestamptz | Auto |

### `religious_content`

Dedicated vector store for religious content (Vaaz Talaqi, Iqtibasaat, Lisan ud Dawat word
meanings), kept entirely separate from `site_content` so the agent's
`answer_religious_questions` tool never cross-contaminates with logistics retrieval. Mirrors
`site_content`. Populated from `religious_topics` blocks (`page_url = 'religious://topic/<id>'`)
and religious uploads (`page_url = 'religious://doc/<id>'`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial | PK |
| `page_url` | text | Namespace: `religious://topic/<id>` or `religious://doc/<id>` |
| `page_title` | text | Display title (the topic/doc name) |
| `section` | text | Chunk identifier (`chunk_1`, …) |
| `content` | text | Chunk text |
| `embedding` | vector(1536) | OpenAI `text-embedding-3-small` |
| `source_type` | text | `topic_block` \| `uploaded_doc` |
| `indexed_at` | timestamptz | Auto |
| `is_current` | boolean | Default true |

### `religious_topics`

Editable "FAQ by Topic" blocks for religious content (the **Religious Content** tab of the
Vectorized Data for Agent page). Not department-scoped. Saving a topic chunks + embeds its
`content` into `religious_content` under `page_url = 'religious://topic/<id>'`. Seeded with
three starter topics (Vaaz Talaqi / Iqtibasaat help, Lisan ud Dawat word meanings,
Guardrails / scope control).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `slug` | text | Unique stable key |
| `title` | text | Display title |
| `content` | text | Editable Q&A text (entries separated by blank lines) |
| `chunk_count` | integer | Vectorized chunks from the last save |
| `sort_order` | integer | Display order |
| `updated_by` | text | Who last saved (nullable) |
| `updated_at` | timestamptz | Auto |

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
| `contact_for_issues` | boolean | When true, this user is notified for new or newly assigned issues in this department |
| `created_at` | timestamptz | Auto |

Unique constraint: `(department_id, user_id)`

### `tasks`

Project-management tickets used by the WhatsApp agent and admin portal.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `department_id` | uuid | FK → `departments.id` (nullable — external issues are untriaged until assigned) |
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

### `conversation_upload_departments`

Join table for transcript uploads that were parsed against multiple departments.

| Column | Type | Notes |
|--------|------|-------|
| `upload_id` | uuid | FK -> `conversation_uploads.id` |
| `department_id` | uuid | FK -> `departments.id` |
| `created_at` | timestamptz | Auto |

Primary key: `(upload_id, department_id)`.

### `transcript_function_calls`

Audit table for OpenAI function calls produced during transcript parsing.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `upload_id` | uuid | FK -> `conversation_uploads.id` |
| `department_ids` | uuid[] | Departments included in parser context |
| `transcript_type` | text | `whatsapp` \| `meeting` |
| `function_name` | text | Usually `extract_project_events` |
| `model` | text | OpenAI model used |
| `request_prompt` | text | Department-specific prompt content sent with fixed prompt |
| `request_context` | jsonb | Existing milestones/tasks/issues and department context |
| `raw_response` | jsonb | Raw OpenAI response |
| `arguments` | jsonb | Parsed function-call arguments |
| `parse_error` | text | JSON/function parsing error, if any |
| `status` | text | `pending` \| `succeeded` \| `failed` |
| `created_at` | timestamptz | Auto |
| `completed_at` | timestamptz | Completion timestamp |

### `conversation_events`

Parsed actionable transcript events that can be reviewed and applied as tasks.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `upload_id` | uuid | FK → `conversation_uploads.id` |
| `department_id` | uuid | FK → `departments.id` |
| `event_type` | text | `task_created` \| `task_updated` \| `task_completed` \| `milestone_created` \| `milestone_updated` \| `issue_created` \| `issue_updated` \| `issue_resolved` \| `decision` \| `info` |
| `task_id` | uuid | FK → `tasks.id` after applying |
| `milestone_id` | uuid | FK -> `milestones.id` for milestone targets or related task/issue milestone |
| `function_call_id` | uuid | FK -> `transcript_function_calls.id` |
| `item_type` | text | `task` \| `issue` \| `milestone` |
| `sender_alias` | text | Transcript sender |
| `message_text` | text | Original message text |
| `message_timestamp` | timestamptz | Parsed message timestamp |
| `ai_summary` | text | Parser summary |
| `task_title` | text | Suggested task/issue title |
| `milestone_title` | text | Suggested milestone title |
| `assigned_to_alias` | text | Friendly assignee name from transcript |
| `assigned_to_user_id` | uuid | Reviewer-selected system user |
| `priority` | text | `low` \| `medium` \| `high` |
| `suggested_status` | text | `open` \| `in_progress` \| `blocked` \| `complete` |
| `due_date` | date | Suggested task/issue due date |
| `source` | text | Suggested source from function call |
| `percent_complete` | integer | Suggested milestone progress |
| `budget` | numeric | Suggested milestone budget |
| `notes` | text | Suggested milestone notes |
| `description` | text | Suggested description |
| `raw_function_event` | jsonb | Individual function event returned by OpenAI |
| `suggested_changes` | jsonb | Suggested field values from function event |
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

### `whatsapp_inbound_locks`

Self-expiring lease lock for message coalescing. One row per active conversation (`phone_e164`). The runner that acquires the lock drains the pending queue; others return immediately. Expired leases are stolen by the next runner.

| Column | Type | Notes |
|--------|------|-------|
| `lock_key` | text | PK — `phone_e164` value |
| `owner_token` | uuid | Random token identifying the lock holder |
| `acquired_at` | timestamptz | When the lock was acquired |
| `expires_at` | timestamptz | Lease expiry (TTL = 180s) |

### `whatsapp_pending_messages`

Inbound message queue for coalescing. Messages are inserted by the webhook handler, claimed by the drain loop, and deleted after a successful reply.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, auto-generated |
| `lock_key` | text | Same as `phone_e164` |
| `phone_e164` | text | Sender phone number |
| `message_id` | text | Unique — WhatsApp message ID (dedup layer 2) |
| `body` | text | Message text |
| `inbound_msg_id` | uuid | FK to `messages.id` (audit link, nullable) |
| `received_at` | timestamptz | Auto |
| `claimed_at` | timestamptz | Set when a runner claims the row (nullable) |
| `claimed_by` | uuid | The runner's `owner_token` (nullable) |

Source: `supabase/migrations/20260602120000_whatsapp_coalescing.sql`

## Supabase RPC Function

`match_site_content(query_embedding, match_threshold, match_count)` — vector similarity search.  
Source: `supabase/migrations/20260529134501_match_site_content.sql`

`match_religious_content(query_embedding, match_threshold, match_count)` — vector similarity
search over `religious_content` (same signature/body as `match_site_content`).  
Source: `supabase/migrations/20260604130000_religious_content.sql`

## Migration Conventions

- One logical change per migration file.
- File name: `YYYYMMDDHHMMSS_short_description.sql`
- Use `create table if not exists` and `create index if not exists` for idempotency where possible.
- Never drop or alter columns in a way that loses data without a data migration plan.
