-- Free-text broadcasts. The send console can now broadcast a plain WhatsApp text message (not just an
-- approved template) to an audience. Free-text only delivers inside the recipient's 24h customer-service
-- window, so the engine restricts these sends to in-window recipients; outside it Meta rejects with
-- error 131047. A free-text broadcast has no template_code (it carries freeform_text instead).

alter table public.template_broadcasts
  add column if not exists message_kind text not null default 'template'
    check (message_kind in ('template', 'text'));

alter table public.template_broadcasts
  add column if not exists freeform_text text;

-- template_code is null for free-text broadcasts.
alter table public.template_broadcasts
  alter column template_code drop not null;

-- A template broadcast must have a template_code; a free-text broadcast must have body text.
alter table public.template_broadcasts
  drop constraint if exists template_broadcasts_kind_payload_check;
alter table public.template_broadcasts
  add constraint template_broadcasts_kind_payload_check
  check (
    (message_kind = 'template' and template_code is not null)
    or (message_kind = 'text' and freeform_text is not null)
  );
