-- Per-majlis / per-category / per-year structured metadata for religious content
-- (Ashara 1448 daily system). Today majlis/category/year live only in the title string
-- and are parsed by regex; this adds explicit columns so content is organized by
-- majlis + category, supports a Lisan translate workflow (language + status), and lets
-- the agent cite "from the <category> of Majlis N". Backfills the existing 1447 blocks.

-- 1. Structured columns on the editable topic blocks.
alter table public.religious_topics
  add column if not exists year_hijri    text,
  add column if not exists majlis_number integer,
  add column if not exists is_ashura     boolean not null default false,
  add column if not exists category      text,
  add column if not exists language      text not null default 'en',
  add column if not exists status        text not null default 'indexed';

do $$ begin
  alter table public.religious_topics add constraint religious_topics_category_chk
    check (category is null or category in
      ('reflection','tazyeen','al_dars','jumla','kalema','unwaan','misc'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.religious_topics add constraint religious_topics_language_chk
    check (language in ('en','lisan'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.religious_topics add constraint religious_topics_status_chk
    check (status in ('indexed','pending_translation','placeholder'));
exception when duplicate_object then null; end $$;

create index if not exists religious_topics_majlis_idx
  on public.religious_topics (year_hijri, majlis_number, category);
create index if not exists religious_topics_status_idx
  on public.religious_topics (status);

-- 2. Denormalize the same onto the vector store (for provenance + optional filtering).
alter table public.religious_content
  add column if not exists year_hijri    text,
  add column if not exists majlis_number integer,
  add column if not exists is_ashura     boolean default false,
  add column if not exists category      text;

-- 3. Recreate the match RPC to also return the metadata (keeps source_url/source_label).
-- Drop first: Postgres won't let CREATE OR REPLACE change a function's return columns.
drop function if exists public.match_religious_content(extensions.vector, float, int);
create or replace function public.match_religious_content(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  page_url text,
  page_title text,
  section text,
  content text,
  source_url text,
  source_label text,
  year_hijri text,
  majlis_number integer,
  category text,
  similarity float
)
language sql stable
set search_path = extensions
as $$
  select id, page_url, page_title, section, content, source_url, source_label,
    year_hijri, majlis_number, category,
    1 - (embedding <=> query_embedding) as similarity
  from public.religious_content
  where is_current = true
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- 4. Backfill the existing 1447 topic blocks from their title strings.
update public.religious_topics
  set year_hijri = substring(title from 'Ashara\s+(\d{4})H')
  where year_hijri is null and title ~ 'Ashara\s+\d{4}H';

update public.religious_topics set category = 'reflection' where category is null and title ~* '^reflections';
update public.religious_topics set category = 'tazyeen'    where category is null and title ~* 'zyeen';
update public.religious_topics set category = 'al_dars'    where category is null and title ~* '^al-dars';
update public.religious_topics set category = 'misc'       where category is null;

-- Ashura (9/10) blocks: flag and clear majlis_number.
update public.religious_topics
  set is_ashura = true, majlis_number = null
  where category in ('reflection','tazyeen','al_dars')
    and (title ~ '9/10' or title ~ '9\s*[–-]\s*10' or title ~* 'lailat');

-- Numbered majlis blocks.
update public.religious_topics
  set majlis_number = (substring(title from 'Majlis\s+0*(\d+)'))::int
  where category in ('reflection','tazyeen','al_dars')
    and is_ashura = false
    and title ~ 'Majlis\s+\d+';

update public.religious_topics
  set language = 'en', status = 'indexed'
  where category in ('reflection','tazyeen','al_dars');

-- 5. Denormalize metadata onto the existing vector chunks.
update public.religious_content c
  set year_hijri    = t.year_hijri,
      majlis_number = t.majlis_number,
      is_ashura     = t.is_ashura,
      category      = t.category
  from public.religious_topics t
  where c.page_url = 'religious://topic/' || t.id::text;
