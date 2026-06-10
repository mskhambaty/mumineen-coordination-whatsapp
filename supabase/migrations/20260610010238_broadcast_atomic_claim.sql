-- Fix duplicate broadcast sends. drainBroadcasts used to SELECT 'queued' recipients, send to them,
-- then flip them to 'sent' — leaving a window where the row was still 'queued'. The every-minute
-- drain cron overlapping a slow batch (150 sequential Meta sends take longer than a minute), plus
-- the inline post-create drain, meant a second drain re-selected the same not-yet-flipped rows and
-- sent again. Result: more (real, billable) messages delivered than recipients.
--
-- The fix: claim a batch atomically — flip 'queued' -> 'sending' inside a FOR UPDATE SKIP LOCKED
-- statement — BEFORE sending. Two concurrent drains can then never grab the same recipient. Rows
-- left in 'sending' by a drain that died mid-batch (e.g. a serverless timeout) are reclaimed after
-- a stale window so the broadcast still finishes. This is at-least-once, not at-most-once: a drain
-- that sent but died before flipping to 'sent' may re-send that one row after the stale window —
-- vastly better than the old always-double-send behavior.
--
-- NOTE: an older overload claim_broadcast_recipients(p_batch int) returning SETOF broadcast_recipients
-- (from the superseded whatsapp_broadcasts system) shadowed this on existing projects, so the code's
-- rpc("claim_broadcast_recipients", { p_batch_size }) call failed with "Could not find the function …
-- in the schema cache". Drop that legacy overload first so only this template-broadcast version remains.

drop function if exists public.claim_broadcast_recipients(integer);

-- 1. Track when a recipient was claimed, so stuck 'sending' rows can be reclaimed.
alter table public.template_broadcast_recipients
  add column if not exists claimed_at timestamptz;

-- 2. Allow the new transient 'sending' state.
alter table public.template_broadcast_recipients
  drop constraint if exists template_broadcast_recipients_send_status_check;
alter table public.template_broadcast_recipients
  add constraint template_broadcast_recipients_send_status_check
  check (send_status in ('queued', 'sending', 'sent', 'failed', 'delivered', 'read', 'replied', 'skipped'));

-- 3. Atomically claim up to p_batch_size pending recipients of running broadcasts. Picks 'queued'
--    rows plus 'sending' rows whose claim has gone stale (older than p_stale_seconds). SKIP LOCKED
--    lets multiple drains run in parallel on disjoint row sets without blocking each other.
create or replace function public.claim_broadcast_recipients(p_batch_size int, p_stale_seconds int default 300)
returns table (
  id uuid,
  broadcast_id uuid,
  phone_e164 text,
  body_params jsonb,
  template_code text,
  template_language text
)
language plpgsql
set search_path to 'public'
as $function$
begin
  return query
  with claimed as (
    select r.id, r.broadcast_id
    from public.template_broadcast_recipients r
    join public.template_broadcasts b on b.id = r.broadcast_id
    where b.status = 'running'
      and (
        r.send_status = 'queued'
        or (r.send_status = 'sending' and r.claimed_at < now() - make_interval(secs => p_stale_seconds))
      )
    order by r.id
    limit p_batch_size
    for update of r skip locked
  )
  update public.template_broadcast_recipients r
  set send_status = 'sending', claimed_at = now()
  from claimed c
  join public.template_broadcasts b on b.id = c.broadcast_id
  where r.id = c.id
  returning r.id, r.broadcast_id, r.phone_e164, r.body_params, b.template_code, b.template_language;
end;
$function$;

-- 4. Atomic counter bump. The old read-modify-write in JS lost increments when concurrent drains
--    bumped the same broadcast — now that drains run in parallel, that would undercount. A single
--    UPDATE ... = col + 1 is safe under concurrency.
create or replace function public.bump_broadcast_counter(p_broadcast_id uuid, p_field text)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if p_field = 'count_sent' then
    update public.template_broadcasts set count_sent = count_sent + 1 where id = p_broadcast_id;
  elsif p_field = 'count_failed' then
    update public.template_broadcasts set count_failed = count_failed + 1 where id = p_broadcast_id;
  else
    raise exception 'invalid counter field: %', p_field;
  end if;
end;
$function$;
