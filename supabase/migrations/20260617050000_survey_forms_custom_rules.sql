-- Allow a survey form to target an ad-hoc custom audience filter (a RuleGroup) instead of a saved
-- group, mirroring the WhatsApp template custom-audience builder. A form sets EITHER group_id (a
-- saved survey_group) OR rules (an inline audience-filter RuleGroup); preview/send resolve whichever
-- is present.
alter table public.survey_forms alter column group_id drop not null;
alter table public.survey_forms add column if not exists rules jsonb;
