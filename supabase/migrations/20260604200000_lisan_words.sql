-- Issue #43 (Path B): exact Lisan ud Dawat word lookup.
-- A dictionary is structured data, so it gets a real lookup table + fuzzy "did you mean"
-- matching (pg_trgm), instead of the fuzzy vector search used for the reflections.
-- Backs the get_lisan_word_meaning agent tool.

create extension if not exists pg_trgm schema extensions;

create table if not exists public.lisan_words (
  id              bigserial primary key,
  transliteration text,           -- Roman, e.g. "Aaeen"
  lisan           text,           -- Lisan ud Dawat script, e.g. "اْئين"
  meaning         text,           -- English meaning
  example         text,           -- example sentence (may be blank)
  norm            text not null,  -- normalized transliteration for exact + fuzzy match
  created_at      timestamptz default now()
);

-- Exact-match lookups on the normalized form.
create index if not exists lisan_words_norm_idx on public.lisan_words (norm);
-- Fuzzy "did you mean" suggestions via trigram similarity.
create index if not exists lisan_words_norm_trgm_idx
  on public.lisan_words using gin (norm extensions.gin_trgm_ops);

alter table public.lisan_words enable row level security;

-- Fuzzy match RPC: returns the closest words to a normalized query, best first.
-- The `%` operator applies pg_trgm's similarity threshold; the caller passes an
-- already-normalized query (same normalization used at import time).
create or replace function public.match_lisan_words(query_norm text, match_count int)
returns table (
  id bigint,
  transliteration text,
  lisan text,
  meaning text,
  example text,
  similarity real
)
language sql stable
set search_path = extensions, public
as $$
  select id, transliteration, lisan, meaning, example,
    similarity(norm, query_norm) as similarity
  from public.lisan_words
  where norm % query_norm
  order by similarity(norm, query_norm) desc, length(norm) asc
  limit match_count;
$$;
