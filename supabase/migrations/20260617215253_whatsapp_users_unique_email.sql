-- Enforce one account per email address (case-insensitive).
--
-- The admin login looks users up by email with `.maybeSingle()`, which errors out
-- with a generic "Database error" whenever more than one row matches. A duplicate
-- email (same address, different phone) therefore locks that user out of sign-in.
-- `phone_e164` is already unique, but nothing prevented two rows sharing an email,
-- so a hand-made admin row and a WhatsApp-onboarded row could collide.
--
-- Partial + lower() so it ignores rows without an email and matches the same
-- case-insensitive rule the auth route uses (src/lib/admin/email.ts).
create unique index if not exists whatsapp_users_email_lower_key
  on public.whatsapp_users (lower(email))
  where email is not null and email <> '';
