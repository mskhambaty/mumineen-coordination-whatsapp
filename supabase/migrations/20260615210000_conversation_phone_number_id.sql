-- Attribute messages and conversations to the WhatsApp number they happened on, so the niyaz RSVP
-- number's traffic (the broadcast account, 630 763 8963) can be split out of the main inbox into a
-- dedicated niyaz inbox. NULL = primary account (preserves all existing single-number behavior).

alter table public.messages add column if not exists phone_number_id text;
create index if not exists messages_phone_number_id_created_at_idx on public.messages (phone_number_id, created_at desc);

alter table public.conversation_sessions add column if not exists phone_number_id text;
create index if not exists conversation_sessions_phone_number_id_idx on public.conversation_sessions (phone_number_id);
