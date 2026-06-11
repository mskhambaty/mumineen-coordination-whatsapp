-- Speed up the "religious/Lisan tool used" filter + the chat export, which query tool_audit_logs
-- by tool_name (and date range) to find the conversations that used a religious tool.
create index if not exists tool_audit_logs_tool_name_created_idx
  on public.tool_audit_logs (tool_name, created_at desc);
