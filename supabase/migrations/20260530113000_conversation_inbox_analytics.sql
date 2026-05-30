-- Add conversation handling state for lead inbox manual takeover.

alter table public.conversation_sessions
  add column if not exists handling_mode text not null default 'ai'
    check (handling_mode in ('ai', 'manual')),
  add column if not exists handling_mode_at timestamptz,
  add column if not exists handling_mode_by uuid references public.whatsapp_users(id) on delete set null;

create index if not exists conversation_sessions_handling_mode_idx
  on public.conversation_sessions (handling_mode);

create index if not exists conversation_sessions_last_message_at_idx
  on public.conversation_sessions (last_message_at desc);

create index if not exists messages_direction_created_at_idx
  on public.messages (direction, created_at desc);
