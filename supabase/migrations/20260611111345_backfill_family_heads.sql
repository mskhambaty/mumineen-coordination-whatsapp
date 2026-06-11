-- Backfill a head-of-family marker for roster-active families that have no member flagged as head.
-- Import set is_head only where a member's own ITS equals their family's hof_its (~933 heads); ~363
-- roster families' head ITS isn't present as a member row, so they have no is_head and were invisible
-- to the HOF reach segments. Designate a primary person for each such family.
--
-- Pick rule (per the "reachable adult first" choice): prefer a member with a WhatsApp number, then an
-- adult (is_adult is null/true; null = adult by convention), then the earliest record, then id.
-- Existing import-marked heads are left untouched.

with headless as (
  select f.id as family_id
  from public.families f
  where f.roster_active
    and not exists (
      select 1 from public.mumineen m
      where m.family_id = f.id and m.roster_active and m.is_head is true
    )
),
ranked as (
  select
    m.id,
    row_number() over (
      partition by m.family_id
      order by
        (m.whatsapp_e164 is not null) desc,        -- reachable first
        (m.is_adult is distinct from false) desc,  -- adult (true/null) before kid
        m.created_at asc nulls last,
        m.id asc
    ) as rn
  from public.mumineen m
  join headless h on h.family_id = m.family_id
  where m.roster_active
)
update public.mumineen
set is_head = true
where id in (select id from ranked where rn = 1);
