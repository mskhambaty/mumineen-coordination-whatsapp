-- Add resolved-by tracking columns and seed a sample lost-and-found item.

alter table public.lost_found_reports
  add column if not exists resolved_by uuid references public.whatsapp_users(id) on delete set null,
  add column if not exists resolved_by_name text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_notes text;

-- Seed one sample item so portal users understand the interface.
insert into public.lost_found_reports (
  report_type, status, item_name, description, category, color, location,
  reporter_name, reporter_phone_e164, reporter_its,
  source, escalation_status
) values (
  'lost', 'open', 'Black leather wallet',
  'Lost near the main entrance after Maghrib. Contains ID and credit cards.',
  'Personal item', 'Black', 'Main masjid entrance',
  'Sample Reporter', '+10000000000', '00000000',
  'manual', 'not_required'
);
