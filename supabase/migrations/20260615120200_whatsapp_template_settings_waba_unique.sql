-- Phase 2 of WABA-scoping the Send Templates console annotations. DEPLOY-COUPLED — apply WITH the
-- multi-account code, not before. It switches uniqueness from template_name alone to
-- (WABA, template_name) so two WABAs can hold a same-named template without their friendly-name /
-- active-flag annotations colliding.
--
-- Dropping the template_name primary key removes the `ON CONFLICT (template_name)` target the
-- pre-multi-account code used for its upsert, so applying this before the new code is deployed would
-- break that save. The new code's upsert is a scoped read-modify-write that doesn't rely on
-- ON CONFLICT, so it works with this index. See phase 1
-- (20260615120000_whatsapp_template_settings_add_waba_id.sql) for the safe, pre-deployable column add.
--
-- waba_id NULL = the primary/legacy account; coalesce() collapses NULL → '' so uniqueness holds per
-- (WABA, template) without needing a backfill.

alter table public.whatsapp_template_settings
  drop constraint if exists whatsapp_template_settings_pkey;

create unique index if not exists whatsapp_template_settings_waba_name_uniq
  on public.whatsapp_template_settings (coalesce(waba_id, ''), template_name);
