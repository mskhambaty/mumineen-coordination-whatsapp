-- Add a test/preview flag to survey recipients so admins can generate a self-test link
-- (full real form flow) without polluting real samples, exposures, or results.
alter table public.survey_recipients add column if not exists is_test boolean not null default false;
