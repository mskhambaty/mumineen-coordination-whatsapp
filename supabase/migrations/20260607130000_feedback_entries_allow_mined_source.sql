-- Allow feedback mined from raw conversations (nightly batch) alongside whatsapp/admin sources.
alter table public.feedback_entries drop constraint if exists feedback_entries_source_check;
alter table public.feedback_entries
  add constraint feedback_entries_source_check check (source in ('whatsapp', 'admin', 'mined'));
