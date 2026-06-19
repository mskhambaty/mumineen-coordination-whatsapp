-- Sections that ride along on many forms (Seating, Overall Experience) shouldn't drive the
-- once-per-event "fresh"/exhaustion logic — otherwise being asked them on one form would distort
-- eligibility for every other form. When dedup_exempt=true, a section's questions are NOT tracked
-- for exposure/exhaustion (each form's fresh-sample set is driven only by its core sections).
alter table public.survey_sections add column if not exists dedup_exempt boolean not null default false;
update public.survey_sections set dedup_exempt = true where key in ('seating', 'final');
