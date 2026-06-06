-- Track when each portal user last successfully logged in, so admins can see
-- who has activated their account and who never has. Stamped by the admin
-- auth route on a successful password check; null means "never logged in".
alter table public.whatsapp_users
  add column if not exists last_login_at timestamptz;
