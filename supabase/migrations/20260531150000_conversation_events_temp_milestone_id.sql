alter table public.conversation_events
  add column if not exists temp_milestone_id text;
