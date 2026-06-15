-- Lisan word requests: words a member asked for that are NOT in the dictionary
-- (get_lisan_word_meaning returned not_found). One open row per normalized word so repeat
-- asks aggregate (times_seen) instead of duplicating. The owner is emailed once on the first
-- sighting (alerted_at) and works the queue down on /admin; adding the word closes its row.
-- Mirrors the knowledge_gaps pattern.

create table public.lisan_word_requests (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  normalized_word text not null,
  status text not null default 'open' check (status in ('open', 'added', 'dismissed')),
  times_seen integer not null default 1,
  last_phone_e164 text,
  alerted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lisan_word_requests_status_idx
  on public.lisan_word_requests (status, times_seen desc, last_seen_at desc);
-- One open row per normalized word so repeat asks aggregate (times_seen) instead of duplicating.
create unique index lisan_word_requests_open_word_uniq
  on public.lisan_word_requests (normalized_word) where status = 'open';

alter table public.lisan_word_requests enable row level security;

comment on table public.lisan_word_requests is
  'Words members asked for that are missing from the Lisan ud Dawat dictionary, queued for the team to add.';
