-- Lisan-script matching robustness. Two problems found in production (June 16, Majlis 1 day):
--  1) Members type the modern Perso-Arabic letters (چ پ گ ٹ …) but the dictionary stores the special
--     Bohra sounds as DOUBLED standard letters (ch→حح, p→ثث, g→كك, retroflex-ṭ→ضض). So a member's
--     "لالچ" never matched the stored "لالحح" — that one word missed 23× in 14 days.
--  2) Transliteration spelling variants (raghbat vs ragbat) didn't share a skeleton because the
--     aspirated digraph "gh"/"kh" wasn't folded.
-- Fix: store a normalized Lisan-script form per row (+ per compound form) to match a normalized query,
-- and fold gh→g / kh→k into the consonant skeleton. Mirrors normalizeLisanScript() / skeleton() in
-- src/lib/knowledge/lisan-words.ts so single-add (JS) and this backfill (SQL) agree.

create extension if not exists pg_trgm schema extensions;
create extension if not exists unaccent schema extensions;

alter table public.lisan_words
  add column if not exists lisan_norm text,
  add column if not exists lisan_forms_norm text[];

-- Mirror of normalizeLisanScript(): map modern letters → the stored doubled-standard convention,
-- unify standard letter variants, strip harakat/tatweel/ZWNJ, collapse spaces.
create or replace function public.lisan_script_norm(s text) returns text
language sql immutable
set search_path = public
as $$
  select trim(regexp_replace(
    regexp_replace(
      translate(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
          coalesce(s, ''),
          'چ', 'حح', 'g'), 'پ', 'ثث', 'g'), 'گ', 'كك', 'g'), 'ٹ', 'ضض', 'g'),
          'ڈ', 'دد', 'g'), 'ڑ', 'رر', 'g'), 'ژ', 'زز', 'g'),
        'کیۍێےہھۀ', 'كييييههه'),
      '[ً-ٰـ‌‍]', '', 'g'),
    '\s+', ' ', 'g'));
$$;

-- Backfill the two normalized Lisan columns.
update public.lisan_words
set lisan_norm = public.lisan_script_norm(lisan),
    lisan_forms_norm = (
      select array_agg(distinct nf) filter (where nf <> '')
      from unnest(coalesce(lisan_forms, array[]::text[])) as f
      cross join lateral (select public.lisan_script_norm(trim(f)) as nf) x
    );

-- Recompute the consonant skeletons WITH digraph folding (gh→g, kh→k), so raghbat≈ragbat.
-- norm_skeleton (whole normalized transliteration):
update public.lisan_words
set norm_skeleton = regexp_replace(
  regexp_replace(
    replace(replace(replace(coalesce(norm, ''), 'gh', 'g'), 'kh', 'k'), ' ', ''),
    '[aeiou]', '', 'g'),
  '(.)\1+', '\1', 'g');

-- skeleton_forms (per roman form): split transliteration → normalize → fold digraphs → skeleton.
with roman as (
  select w.id,
    array_agg(distinct s.skel) filter (where s.skel <> '') as sf
  from public.lisan_words w
  cross join lateral regexp_split_to_table(coalesce(w.transliteration, ''), '\s+-\s+|[,،/;]') as f(form)
  cross join lateral (
    select trim(regexp_replace(regexp_replace(lower(extensions.unaccent(f.form)), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as nform
  ) n
  cross join lateral (
    select regexp_replace(regexp_replace(
      replace(replace(replace(n.nform, 'gh', 'g'), 'kh', 'k'), ' ', ''),
      '[aeiou]', '', 'g'), '(.)\1+', '\1', 'g') as skel
  ) s
  group by w.id
)
update public.lisan_words w
  set skeleton_forms = roman.sf
  from roman
  where w.id = roman.id;

create index if not exists lisan_words_lisan_forms_norm_idx on public.lisan_words using gin (lisan_forms_norm);
create index if not exists lisan_words_lisan_norm_trgm_idx
  on public.lisan_words using gin (lisan_norm extensions.gin_trgm_ops);
