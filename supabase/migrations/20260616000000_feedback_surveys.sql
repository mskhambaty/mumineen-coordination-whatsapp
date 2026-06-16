-- Targeted feedback-survey system (separate from the conversation-mined feedback_entries).
-- A databank of sections + questions is composed into per-day forms targeted at a group of
-- mumineen (defined via the audience rule engine), sampled fresh-first, and delivered as a
-- per-recipient tokenized web-form link over WhatsApp. Responses are attributed to the exact
-- mumin via their token, scored 1-5 per section, and a (mumin, question) is never re-asked
-- for the whole event. All tables are service-role only (RLS on, no policies) like the rest
-- of the app; FKs to mumineen/families use ON DELETE SET NULL to preserve the response record.

-- 1. Section databank ----------------------------------------------------------------------
create table if not exists public.survey_sections (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  description text,
  area text not null check (area in (
    'mawaid', 'flow', 'parking_transport', 'audio_video',
    'accommodation', 'seating', 'general'
  )),
  is_general boolean not null default false,          -- applies to everyone, any form
  default_rule jsonb,                                  -- suggested group rule (audience RuleGroup)
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Question databank ---------------------------------------------------------------------
create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.survey_sections(id) on delete cascade,
  text text not null,
  type text not null check (type in ('choice', 'scale10', 'scale5', 'yesno', 'text')),
  options jsonb,                                       -- [{label, score?}] for choice types
  negative_values jsonb,                               -- answers that trigger the "why" box / count negative
  polarity text not null default 'positive' check (polarity in ('positive', 'negative')),
  is_general boolean not null default false,           -- ask everyone in the form (not group-gated)
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists survey_questions_section_idx on public.survey_questions (section_id);

-- 3. Target groups (saved audience rules) --------------------------------------------------
create table if not exists public.survey_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  rules jsonb not null,                                -- audience-filter RuleGroup for runFilter()
  area_focus text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Composed forms / runs -----------------------------------------------------------------
create table if not exists public.survey_forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  group_id uuid references public.survey_groups(id) on delete set null,
  sample_size integer not null default 40,
  event_date date,
  status text not null default 'draft' check (status in ('draft', 'sampled', 'sent', 'closed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists survey_forms_status_date_idx on public.survey_forms (status, event_date);

-- 5. The form's composed questions (snapshot for stability) --------------------------------
create table if not exists public.survey_form_questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.survey_forms(id) on delete cascade,
  section_id uuid references public.survey_sections(id) on delete set null,
  question_id uuid references public.survey_questions(id) on delete set null,
  area text,
  snapshot jsonb not null,                             -- {text, type, options, negative_values, polarity, section_title}
  sort_order integer not null default 0
);
create index if not exists survey_form_questions_form_idx on public.survey_form_questions (form_id);

-- 6. Sampled recipients + token + lifecycle (attribution + dedup core) ---------------------
create table if not exists public.survey_recipients (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.survey_forms(id) on delete cascade,
  mumin_id uuid references public.mumineen(id) on delete set null,
  family_id uuid references public.families(id) on delete set null,
  phone_e164 text,
  group_id uuid references public.survey_groups(id) on delete set null,
  token text not null unique,
  status text not null default 'sampled' check (status in ('sampled', 'sent', 'opened', 'completed', 'failed')),
  broadcast_recipient_id uuid,
  event_date date,
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists survey_recipients_form_idx on public.survey_recipients (form_id);
create index if not exists survey_recipients_mumin_date_idx on public.survey_recipients (mumin_id, event_date);
create index if not exists survey_recipients_token_idx on public.survey_recipients (token);

-- 7. (mumin, question) exposure index — enforces once-per-event no-repeat -------------------
create table if not exists public.survey_question_exposures (
  id uuid primary key default gen_random_uuid(),
  mumin_id uuid not null references public.mumineen(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id) on delete cascade,
  form_id uuid references public.survey_forms(id) on delete set null,
  event_date date,
  created_at timestamptz not null default now(),
  unique (mumin_id, question_id)
);
create index if not exists survey_exposures_question_idx on public.survey_question_exposures (question_id);

-- 8. Granular answers (quantitative + qualitative) -----------------------------------------
create table if not exists public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.survey_recipients(id) on delete cascade,
  form_id uuid references public.survey_forms(id) on delete set null,
  mumin_id uuid references public.mumineen(id) on delete set null,
  family_id uuid references public.families(id) on delete set null,
  section_id uuid references public.survey_sections(id) on delete set null,
  question_id uuid references public.survey_questions(id) on delete set null,
  area text,
  answer_text text,
  answer_numeric integer,
  reason_text text,
  sentiment_1_5 integer check (sentiment_1_5 is null or (sentiment_1_5 >= 1 and sentiment_1_5 <= 5)),
  department_ids uuid[] not null default '{}',
  event_date date,
  created_at timestamptz not null default now()
);
create index if not exists survey_answers_form_section_idx on public.survey_answers (form_id, section_id);
create index if not exists survey_answers_recipient_idx on public.survey_answers (recipient_id);
create index if not exists survey_answers_area_date_idx on public.survey_answers (area, event_date);

-- RLS: enable on every table; access is service-role only (app-layer authz), like feedback_entries.
alter table public.survey_sections enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_groups enable row level security;
alter table public.survey_forms enable row level security;
alter table public.survey_form_questions enable row level security;
alter table public.survey_recipients enable row level security;
alter table public.survey_question_exposures enable row level security;
alter table public.survey_answers enable row level security;
