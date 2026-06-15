-- Record which WhatsApp number (account) a broadcast sends from. The drain reads this to resolve the
-- matching credentials and WABA-scoped template, so a broadcast of a higher-tier number's template
-- goes out from that number. NULL = the primary account (legacy / single-number broadcasts).

alter table public.template_broadcasts
  add column if not exists phone_number_id text;
