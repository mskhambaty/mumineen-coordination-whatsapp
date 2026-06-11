-- Per-broadcast send throttle. To avoid Meta's spam/throughput rate limit (error 131048), a broadcast
-- can now carry its own pacing: how many recipients the drain sends per invocation (batch_size) and
-- how long it waits between individual sends (send_interval_ms). Both are nullable — when null the
-- drain falls back to the WHATSAPP_DRAIN_BATCH_SIZE / WHATSAPP_SEND_INTERVAL_MS env defaults, then to
-- code constants. Set per send from the admin console so staff can dial the rate to the number's
-- current headroom.

alter table public.template_broadcasts
  add column if not exists batch_size integer
    check (batch_size is null or (batch_size >= 1 and batch_size <= 150)),
  add column if not exists send_interval_ms integer
    check (send_interval_ms is null or (send_interval_ms >= 0 and send_interval_ms <= 60000));

comment on column public.template_broadcasts.batch_size is
  'Max recipients the drain sends per invocation for this broadcast (1-150). Null = env/default.';
comment on column public.template_broadcasts.send_interval_ms is
  'Delay between individual sends within a drain batch, in ms (0-60000). Null = env/default.';
