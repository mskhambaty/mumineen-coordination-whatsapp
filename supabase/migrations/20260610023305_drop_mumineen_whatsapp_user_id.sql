-- Remove the unused mumineen.whatsapp_user_id FK. It was defined in the original roster migration
-- as a planned link to whatsapp_users, but was never populated (0 rows) and is read by no code —
-- the WhatsApp agent personalizes via mumin_phone_links (phone → mumin), not this column. Dropping
-- it removes a dead, confusing half-feature. No functions/views depend on it.
alter table public.mumineen drop column if exists whatsapp_user_id;
