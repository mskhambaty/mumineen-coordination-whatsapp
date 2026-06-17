-- Free-form tags on a survey form for quick identification when several forms share the same title
-- but target different audiences (e.g. "rahat", "mehman", "day-2").
alter table public.survey_forms add column if not exists tags text[] not null default '{}';
