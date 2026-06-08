-- Layer personalization + custom audiences onto the template-broadcast feature: store the audience
-- rule tree + variable bindings on the broadcast, per-recipient resolved template params, and a
-- 'skipped' recipient state (no phone / missing a mapped field).

alter table public.template_broadcasts
  add column if not exists audience_rules jsonb,
  add column if not exists variable_bindings jsonb,
  add column if not exists count_skipped integer not null default 0;

alter table public.template_broadcast_recipients
  add column if not exists body_params jsonb,
  add column if not exists skip_reason text;

alter table public.template_broadcast_recipients
  drop constraint if exists template_broadcast_recipients_send_status_check;
alter table public.template_broadcast_recipients
  add constraint template_broadcast_recipients_send_status_check
  check (send_status in ('queued', 'sent', 'failed', 'delivered', 'read', 'replied', 'skipped'));
