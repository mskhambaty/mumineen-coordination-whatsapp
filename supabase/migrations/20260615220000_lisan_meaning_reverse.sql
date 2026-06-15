-- Two-way Lisan lookup: reverse direction (English meaning → Lisan word).
-- The forward path matches a transliterated/Lisan word against `norm` (pg_trgm). For "what is the
-- Lisan ud Dawat word for brain", we need to search the English `meaning` instead. Two recall paths:
--   1. exact gloss-WORD match: tokenize `meaning` into individual lowercased words (meaning_terms),
--      so query "hardworking" hits the entry glossed "Painstaking, hardworking".
--   2. fuzzy word-trigram (`<%` / word_similarity) over `meaning`, so "calm" finds "calmness, ...".
-- Computed from existing data; populated for new rows by prepareLisanRow.

create extension if not exists pg_trgm schema extensions;
create extension if not exists unaccent schema extensions;

alter table public.lisan_words
  add column if not exists meaning_terms text[];

-- Tokenize each meaning into distinct gloss words: unaccent + lowercase, split on any non-alnum,
-- drop 1-char tokens and a few function words so "word for X" matches on real terms only.
update public.lisan_words w
  set meaning_terms = sub.terms
  from (
    select id,
      array_agg(distinct t) filter (
        where length(t) >= 2
          and t not in ('of','the','an','to','or','and','in','on','for','with','at','by','as','is')
      ) as terms
    from (
      select w2.id,
        regexp_split_to_table(lower(extensions.unaccent(coalesce(w2.meaning, ''))), '[^a-z0-9]+') as t
      from public.lisan_words w2
    ) x
    group by id
  ) sub
  where w.id = sub.id;

-- Exact gloss-word match (overlaps query terms).
create index if not exists lisan_words_meaning_terms_idx
  on public.lisan_words using gin (meaning_terms);
-- Fuzzy word-trigram over the full meaning (supports `<%` / word_similarity).
create index if not exists lisan_words_meaning_trgm_idx
  on public.lisan_words using gin (meaning extensions.gin_trgm_ops);

-- Reverse fuzzy match RPC: closest meanings to an English query, best first. `<%` uses pg_trgm's
-- word_similarity threshold (the query vs the most-similar word inside `meaning`), so a one-word
-- query isn't diluted by a long multi-gloss meaning string.
create or replace function public.match_lisan_by_meaning(query_text text, match_count int)
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
    word_similarity(query_text, meaning) as similarity
  from public.lisan_words
  where query_text <% meaning
  order by word_similarity(query_text, meaning) desc, length(meaning) asc
  limit match_count;
$$;
