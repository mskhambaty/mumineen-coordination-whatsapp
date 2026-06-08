-- Per-form indexing for compound Lisan dictionary entries. ~7% of rows bundle several
-- word-forms in one entry, e.g. transliteration "Ne'mat - Ne'am, An'um" / lisan
-- "نعمة - نعم، انعم". The whole-entry norm/skeleton then never matches a single-word query
-- ("nemat" → skeleton "nmt" ≠ the compound's "nmtnmnm"). So split each entry into its forms
-- and index a skeleton per roman form + the exact Arabic forms. Computed from existing data.

create extension if not exists unaccent schema extensions;

alter table public.lisan_words
  add column if not exists skeleton_forms text[],
  add column if not exists lisan_forms text[];

-- Roman: split transliteration on form separators ( " - ", "," , "،", "/", ";" ), normalize
-- each form (unaccent + lowercase + strip non-alnum), then take its consonant skeleton.
with roman as (
  select w.id,
    array_agg(distinct s.skel) filter (where s.skel <> '') as sf
  from public.lisan_words w
  cross join lateral regexp_split_to_table(coalesce(w.transliteration, ''), '\s+-\s+|[,،/;]') as f(form)
  cross join lateral (
    select trim(regexp_replace(regexp_replace(lower(extensions.unaccent(f.form)), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as nform
  ) n
  cross join lateral (
    select regexp_replace(regexp_replace(replace(n.nform, ' ', ''), '[aeiou]', '', 'g'), '(.)\1+', '\1', 'g') as skel
  ) s
  group by w.id
),
arab as (
  select w.id, array_agg(distinct trim(lf.form)) filter (where trim(lf.form) <> '') as lf
  from public.lisan_words w
  cross join lateral regexp_split_to_table(coalesce(w.lisan, ''), '\s+-\s+|[,،/;]') as lf(form)
  group by w.id
)
update public.lisan_words w
  set skeleton_forms = roman.sf, lisan_forms = arab.lf
  from roman, arab
  where w.id = roman.id and w.id = arab.id;

create index if not exists lisan_words_skeleton_forms_idx on public.lisan_words using gin (skeleton_forms);
create index if not exists lisan_words_lisan_forms_idx on public.lisan_words using gin (lisan_forms);
