-- Consonant-skeleton column for fuzzy Lisan word matching. Dawat transliteration varies
-- vowels/endings a lot ("sadqe"/"sadaqe" vs "Sadaqa"), which trigram similarity misses;
-- the skeleton (norm with spaces+vowels removed and repeats collapsed) recovers them.
-- Computed from the existing `norm`, so no re-import is needed.

alter table public.lisan_words add column if not exists norm_skeleton text;

update public.lisan_words
  set norm_skeleton = regexp_replace(
        regexp_replace(replace(coalesce(norm, ''), ' ', ''), '[aeiou]', '', 'g'),
        '(.)\1+', '\1', 'g')
  where norm_skeleton is null;

create index if not exists lisan_words_skeleton_idx on public.lisan_words (norm_skeleton);
