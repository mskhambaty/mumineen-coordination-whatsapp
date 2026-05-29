create or replace function public.set_whatsapp_users_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create index if not exists conversation_sessions_user_id_idx
  on public.conversation_sessions (user_id);
