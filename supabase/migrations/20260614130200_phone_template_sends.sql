-- Per-phone, per-template send history for the custom-audience builder's "Template history" filter
-- group (sent / not sent template X within the last N hours). The complete record of template sends
-- is the `[template:NAME] …` prefix recordOutboundMessage() writes to messages.body for EVERY send
-- (broadcasts + escalation/issue/welcome/digest/composer), so the marker — not the broadcast tables —
-- is the source. Extract the template code from the marker; one row per (phone, template) with the
-- last-sent timestamp so a recency window can be evaluated. security_invoker; read via service role.

create or replace view public.phone_template_sends
with (security_invoker = on) as
select
  phone_e164,
  substring(body from '^\[template:([^]]+)\]') as template_code,
  max(created_at) as last_sent_at,
  count(*)        as send_count
from public.messages
where direction = 'outbound' and body like '[template:%'
group by phone_e164, substring(body from '^\[template:([^]]+)\]');
