-- Keep template_broadcasts.count_sent / count_failed honest after send time.
--
-- count_sent / count_failed are bumped once, at send time, in drainBroadcasts (bump_broadcast_counter):
-- a message Meta accepts is counted in count_sent, a send-API rejection in count_failed. But Meta
-- reports many failures ASYNCHRONOUSLY via delivery-status webhooks (e.g. 131026 "number not on
-- WhatsApp"). applyBroadcastStatuses flipped the recipient row to send_status='failed' but never
-- touched the aggregate columns, so the console header (which reads count_failed) understated real
-- failures while the live recipient-row rollup showed the true number — e.g. header "1" vs rollup "65".
--
-- Fix: an atomic two-column adjuster the webhook path calls when a recipient first transitions into
-- 'failed' (count_failed +1, and count_sent -1 when the row had been counted as sent). greatest(0, …)
-- guards against underflow from any out-of-order/duplicate webhook.

create or replace function public.adjust_broadcast_counters(p_broadcast_id uuid, p_sent_delta int, p_failed_delta int)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  update public.template_broadcasts
  set count_sent = greatest(0, count_sent + p_sent_delta),
      count_failed = greatest(0, count_failed + p_failed_delta)
  where id = p_broadcast_id;
end;
$function$;

-- One-time backfill: recompute the aggregate columns from the recipient rows so existing broadcasts
-- (whose async failures never reached the columns) self-correct to the same numbers the rollup shows.
-- count_sent = currently in a delivered-class state; count_failed = currently failed.
update public.template_broadcasts b
set count_sent = sub.sent,
    count_failed = sub.failed
from (
  select broadcast_id,
         count(*) filter (where send_status in ('sent', 'delivered', 'read', 'replied')) as sent,
         count(*) filter (where send_status = 'failed') as failed
  from public.template_broadcast_recipients
  group by broadcast_id
) sub
where b.id = sub.broadcast_id;
