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

Index: `(phone_e164, created_at desc)`

### `conversation_sessions`

One row per phone number; upserted on every message.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `phone_e164` | text | Unique |
| `user_id` | uuid | FK → `whatsapp_users.id` (nullable) |
| `current_intent` | text | Last detected intent (nullable, not yet used) |
| `state` | jsonb | Arbitrary session state (default: `{}`) |
| `last_message_at` | timestamptz | Updated each exchange |
| `created_at` | timestamptz | Auto |

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
