-- Add a per-majlis "faq" category for religious_topics: a curated Q&A bucket (likely member questions
-- + grounded answers, pasted in) indexed like the other content cells, so the agent answers recurring
-- and "list all N" questions from a vetted answer rather than improvising from raw reflection prose.

alter table public.religious_topics drop constraint if exists religious_topics_category_chk;
alter table public.religious_topics add constraint religious_topics_category_chk
  check (category is null or category in
    ('reflection','tazyeen','al_dars','jumla','kalema','unwaan','overview','faq','misc'));
