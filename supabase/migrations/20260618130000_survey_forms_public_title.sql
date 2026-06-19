-- Recipient-facing title shown on the public feedback form header. The `title` column stays an
-- internal/admin label (e.g. "Flow (Daily)"); public_title is what mumineen see. NULL → a generic
-- default ("Mumineen Feedback") so the internal label is never exposed.
alter table public.survey_forms add column if not exists public_title text;
