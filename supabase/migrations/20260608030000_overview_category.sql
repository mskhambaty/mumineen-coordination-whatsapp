-- Add a year-level "overview" category for religious_topics: a curated overall-theme block
-- per Ashara year (majlis_number null), so the agent can answer broad "what was the whole
-- Ashara / last year about" questions from a dedicated source instead of improvising.

alter table public.religious_topics drop constraint if exists religious_topics_category_chk;
alter table public.religious_topics add constraint religious_topics_category_chk
  check (category is null or category in
    ('reflection','tazyeen','al_dars','jumla','kalema','unwaan','overview','misc'));
