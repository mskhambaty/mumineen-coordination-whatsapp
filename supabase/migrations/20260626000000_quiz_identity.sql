-- Quiz identity: shift the quiz to a single SHARED link where takers self-identify with ITS + name
-- (maximises reach — no per-recipient tokens, no login). Per-recipient tokens remain ONLY for the
-- admin "generate test link" path. This migration adds ITS + timing to quiz_recipients, makes the
-- token nullable, enforces one attempt per ITS, and introduces a quizzes table that backs the
-- shared link and an open/close switch. Service-role only (RLS on, no policies) like the rest.

alter table public.quiz_recipients
  add column if not exists its_number text,
  add column if not exists time_taken_seconds integer,
  add column if not exists duration_seconds integer;

-- Self-identified takers have no personal token; only admin test links do.
alter table public.quiz_recipients alter column token drop not null;

-- One attempt per ITS per quiz. NULL its_number rows (admin test links) are exempt — Postgres treats
-- NULLs as distinct, so the partial predicate keeps them out of the constraint entirely.
create unique index if not exists quiz_recipients_quiz_its_uniq
  on public.quiz_recipients (quiz_key, its_number) where its_number is not null;
create index if not exists quiz_recipients_its_idx on public.quiz_recipients (its_number);

create table if not exists public.quizzes (
  quiz_key text primary key,                 -- matches the code QUIZ_KEY ('ashara-1448h')
  share_token text not null unique,          -- the public shareable path segment (/quiz/<share_token>)
  is_open boolean not null default true,     -- close to stop accepting new attempts
  title text,
  created_at timestamptz not null default now()
);
alter table public.quizzes enable row level security;

-- Seed the shared link for the Ashara 1448H quiz. Rotate share_token to revoke an old link.
insert into public.quizzes (quiz_key, share_token, is_open, title)
values ('ashara-1448h', 'ashara-1448h-quiz', true, 'Ashara Mubaraka 1448H — Knowledge Quiz')
on conflict (quiz_key) do nothing;
