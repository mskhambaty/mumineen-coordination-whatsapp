-- Stratified sampling for a form: an ordered list of strata, each its own audience filter + quota,
-- e.g. [{label:"Local", rules:{...}, size:107},{label:"Mehman", rules:{...}, size:70}]. When set, it
-- supersedes group_id/rules — preview & send sample each stratum from its pool and combine into one
-- send. NULL keeps the existing single-group/custom-filter behavior.
alter table public.survey_forms add column if not exists sample_plan jsonb;
