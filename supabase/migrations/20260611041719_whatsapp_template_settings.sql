-- Per-template admin settings for the Send Templates console: a friendly display name and an
-- on-our-side "active" flag. Meta is the source of truth for the templates themselves; this table
-- only annotates them. Inactive templates are hidden from the console's pickers (the cleanup popup
-- can still see and reactivate them). Keyed by the Meta template name.

create table if not exists public.whatsapp_template_settings (
  template_name text primary key,
  friendly_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_template_settings enable row level security;

create or replace function public.set_whatsapp_template_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger whatsapp_template_settings_updated_at
  before update on public.whatsapp_template_settings
  for each row execute function public.set_whatsapp_template_settings_updated_at();
