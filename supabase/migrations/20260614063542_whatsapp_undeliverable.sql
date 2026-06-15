-- WhatsApp undeliverable numbers: a phone-keyed suppression list so we stop re-sending (and re-paying
-- for) template messages to numbers that aren't on WhatsApp / can't receive. Meta reports these
-- asynchronously on the delivery-status webhook as a failed status with error code 131026; we count
-- those per number and, once a number crosses a small failure threshold, mark it 'suppressed' so the
-- audience layer drops it from every future broadcast. Keyed by phone (not mumin) because the failure
-- arrives with only the wa_message_id -> recipient row -> phone, and the audience layer dedupes by
-- phone anyway. Admins can un-flag a number (clears suppression + resets the counter) — see
-- /api/admin/whatsapp/undeliverable. Storing the phone here is correct (RLS-protected, server-only);
-- it never escapes to logs or the client.

create table public.whatsapp_undeliverable (
  phone_e164 text primary key,
  fail_count int not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  last_error_code int,
  suppressed boolean not null default false,
  suppressed_at timestamptz,
  cleared_at timestamptz,
  cleared_by uuid references public.whatsapp_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_undeliverable enable row level security;

comment on table public.whatsapp_undeliverable is
  'Phone-keyed suppression list for numbers Meta reports as undeliverable (not on WhatsApp / can''t receive). Once suppressed, the audience layer skips the number on all future broadcasts. Server-only (service role); accessed via /api/admin/whatsapp/undeliverable.';

-- Index for the audience-layer scan of currently-suppressed numbers.
create index whatsapp_undeliverable_suppressed_idx on public.whatsapp_undeliverable (suppressed) where suppressed;

-- Atomically record one undeliverable failure for a number and (re)compute suppression. Upsert so
-- concurrent drains/webhooks bumping the same number never lose a count (must not be a JS
-- read-modify-write). A number stays suppressed once it crosses p_threshold; only an admin un-flag
-- (which resets fail_count to 0 and suppressed to false) starts the count over.
create or replace function public.record_whatsapp_undeliverable(
  p_phone text,
  p_error_code int,
  p_threshold int
) returns void language plpgsql as $$
begin
  insert into public.whatsapp_undeliverable
    (phone_e164, fail_count, first_failed_at, last_failed_at, last_error_code, suppressed, suppressed_at)
  values
    (p_phone, 1, now(), now(), p_error_code, (1 >= p_threshold), case when 1 >= p_threshold then now() else null end)
  on conflict (phone_e164) do update set
    fail_count = public.whatsapp_undeliverable.fail_count + 1,
    last_failed_at = now(),
    last_error_code = p_error_code,
    suppressed = public.whatsapp_undeliverable.suppressed
                 or (public.whatsapp_undeliverable.fail_count + 1 >= p_threshold),
    suppressed_at = case
      when public.whatsapp_undeliverable.suppressed then public.whatsapp_undeliverable.suppressed_at
      when public.whatsapp_undeliverable.fail_count + 1 >= p_threshold then now()
      else null
    end;
end;
$$;
