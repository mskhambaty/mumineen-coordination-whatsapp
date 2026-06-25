-- Ashara knowledge-quiz capture (separate from feedback_surveys — does NOT touch that system).
-- The quiz QUESTIONS live in code (src/lib/quiz/questions.ts) as the bilingual source of truth so
-- translations are fed by editing that file; these tables store only WHO took it and their SCORE.
-- A per-recipient opaque token (same pattern as survey_recipients) is baked into the WhatsApp link
-- and maps back to exactly one recipient. Service-role only (RLS on, no policies) like the rest of
-- the app; FKs to mumineen/families use ON DELETE SET NULL to preserve the attempt record.

create table if not exists public.quiz_recipients (
  id uuid primary key default gen_random_uuid(),
  quiz_key text not null,                              -- which quiz (e.g. 'ashara-1448h')
  mumin_id uuid references public.mumineen(id) on delete set null,
  family_id uuid references public.families(id) on delete set null,
  phone_e164 text,
  display_name text,                                   -- for the admin-only leaderboard
  token text not null unique,
  status text not null default 'sampled' check (status in ('sampled', 'sent', 'opened', 'completed')),
  score integer,                                       -- correct answers (set on completion)
  total integer,                                       -- questions answered/graded
  is_test boolean not null default false,              -- self-test links: excluded from the leaderboard
  broadcast_recipient_id uuid,
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists quiz_recipients_quiz_idx on public.quiz_recipients (quiz_key);
create index if not exists quiz_recipients_token_idx on public.quiz_recipients (token);

create table if not exists public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.quiz_recipients(id) on delete cascade,
  quiz_key text not null,
  question_id text not null,                           -- the code question id ('q1'..)
  chosen_index integer,                                -- option the recipient picked (0-3), null if skipped
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  unique (recipient_id, question_id)
);
create index if not exists quiz_answers_recipient_idx on public.quiz_answers (recipient_id);

alter table public.quiz_recipients enable row level security;
alter table public.quiz_answers enable row level security;
