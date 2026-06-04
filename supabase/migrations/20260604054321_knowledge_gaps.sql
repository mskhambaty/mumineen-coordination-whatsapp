-- Knowledge gaps: topics the AI agent couldn't answer from indexed content, flagged in real time
-- (via the flag_knowledge_gap tool) so the team can publish FAQs. Reconstructed from the live database.

create table public.knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  normalized_topic text not null,
  sample_question text,
  status text not null default 'open' check (status in ('open', 'addressed', 'dismissed')),
  times_seen integer not null default 1,
  last_phone_e164 text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_gaps_status_idx on public.knowledge_gaps (status, times_seen desc, last_seen_at desc);
-- One open row per topic so repeat questions aggregate (times_seen) instead of duplicating.
create unique index knowledge_gaps_open_topic_uniq on public.knowledge_gaps (normalized_topic) where status = 'open';

alter table public.knowledge_gaps enable row level security;

comment on table public.knowledge_gaps is 'Topics the AI agent could not answer from indexed content, flagged for the team to publish FAQs.';
