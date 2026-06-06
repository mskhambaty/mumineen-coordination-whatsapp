-- Issue #43 (citations): attach a source (URL + label) to Waaz Talaqi content so the
-- agent can cite where each answer came from (e.g. "Reflections — Majlis 2 — <blog link>").
-- Source lives on the editable topic (master) and is denormalized onto the indexed chunks
-- so both the majlis-by-number path and the vector path can cite.

alter table public.religious_topics
  add column if not exists source_url text,
  add column if not exists source_label text;

alter table public.religious_content
  add column if not exists source_url text,
  add column if not exists source_label text;

-- Recreate the match RPC to also return the source columns.
create or replace function public.match_religious_content(query_embedding extensions.vector(1536), match_threshold float, match_count int)
returns table (
  id bigint,
  page_url text,
  page_title text,
  section text,
  content text,
  source_url text,
  source_label text,
  similarity float
)
language sql stable
set search_path = extensions
as $$
  select id, page_url, page_title, section, content, source_url, source_label,
    1 - (embedding <=> query_embedding) as similarity
  from public.religious_content
  where is_current = true
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
