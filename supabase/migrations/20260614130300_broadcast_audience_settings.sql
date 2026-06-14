-- Record which audience toggles a broadcast used, so the send log can show how each audience was
-- defined (alongside the already-stored audience_rules + variable_bindings). The conversation-window
-- filter and its hours override, plus the picked user ids for the selected_users audience, arrive in
-- the send request but weren't persisted. All nullable — older broadcasts read as "not recorded".

alter table public.template_broadcasts
  add column if not exists window_filter text,
  add column if not exists window_hours integer,
  add column if not exists selected_user_ids uuid[];
