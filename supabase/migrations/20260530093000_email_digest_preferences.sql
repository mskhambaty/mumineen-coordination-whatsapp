-- Add per-user daily digest preference.

alter table public.whatsapp_users
  add column if not exists email_digest boolean not null default true;

create index if not exists whatsapp_users_email_digest_idx
  on public.whatsapp_users (email_digest)
  where email is not null and status = 'active';
