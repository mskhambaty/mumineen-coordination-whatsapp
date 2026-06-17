-- Per-question optional vs mandatory. Default false (optional) preserves existing frictionless
-- behavior; when true, the public form blocks submit until it's answered.
alter table public.survey_questions add column if not exists required boolean not null default false;
