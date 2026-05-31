alter table public.whatsapp_users
  add column if not exists password_hash text,
  add column if not exists password_updated_at timestamptz,
  add column if not exists password_reset_token_hash text,
  add column if not exists password_reset_expires_at timestamptz;

create unique index if not exists whatsapp_users_password_reset_token_hash_idx
  on public.whatsapp_users (password_reset_token_hash)
  where password_reset_token_hash is not null;
