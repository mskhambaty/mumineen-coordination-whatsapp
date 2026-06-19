-- Recurring-reminder forms (Atfaal/Rahat "every 3 days"): keep asking people UNTIL they respond.
-- When true, sampling excludes anyone who has ANSWERED this form's questions (not merely been sent
-- them), and the send does NOT write exposures — so non-responders stay eligible to be re-nudged on
-- the next run, and responders drop out.
alter table public.survey_forms add column if not exists resend_until_responded boolean not null default false;
update public.survey_forms set resend_until_responded = true where 'atfaal' = any(tags);
