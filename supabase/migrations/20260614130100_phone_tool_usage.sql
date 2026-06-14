-- Per-phone, per-tool AI-agent usage aggregates for the custom-audience builder's "AI tool usage"
-- filter group (used / didn't use tool X within the last N hours). Sourced from tool_audit_logs,
-- which recordToolAudit() writes after every agent tool invocation. Only allowed (permitted) calls
-- count. security_invoker so the view respects tool_audit_logs' RLS; read via service role.

create or replace view public.phone_tool_usage
with (security_invoker = on) as
select
  phone_e164,
  tool_name,
  max(created_at) as last_used_at,
  count(*)        as use_count
from public.tool_audit_logs
where allowed = true
group by phone_e164, tool_name;
