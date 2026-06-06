-- Track when each committee member first received their onboarding welcome
-- (email + WhatsApp), so the automatic add-to-department flow only welcomes a
-- user once even if they are later added to additional departments. The manual
-- "Send welcome" admin action bypasses this guard and re-stamps the timestamp.
-- null means "never welcomed".
alter table public.whatsapp_users
  add column if not exists welcomed_at timestamptz;
