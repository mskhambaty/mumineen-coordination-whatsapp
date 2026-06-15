-- Per-phone inbound/outbound messaging aggregates for the custom-audience builder's "Engagement"
-- filter group (conversed recently, never conversed, no reply, inbound volume). Counts + timestamps
-- only — never message bodies — so no PII crosses the boundary. security_invoker so the view respects
-- messages' RLS; the app reads it via service role (getSupabaseAdmin).

create or replace view public.phone_message_stats
with (security_invoker = on) as
select
  phone_e164,
  count(*) filter (where direction = 'inbound')          as inbound_count,
  count(*) filter (where direction = 'outbound')         as outbound_count,
  max(created_at) filter (where direction = 'inbound')   as last_inbound_at,
  max(created_at) filter (where direction = 'outbound')  as last_outbound_at
from public.messages
group by phone_e164;
