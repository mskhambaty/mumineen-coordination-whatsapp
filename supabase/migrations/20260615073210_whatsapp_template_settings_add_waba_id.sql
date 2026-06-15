-- Phase 1 of WABA-scoping the Send Templates console annotations. ADDITIVE and SAFE to apply ahead
-- of the multi-account code deploy: it only adds the waba_id column and KEEPS the existing
-- template_name primary key. The currently-deployed code is unaffected — its
-- `ON CONFLICT (template_name)` upsert still has its unique target, and waba_id simply stays NULL.
--
-- Phase 2 (20260615073334_whatsapp_template_settings_waba_unique.sql) drops the primary key and adds
-- the (WABA, template_name) uniqueness. That one is NOT safe to apply early — dropping the PK removes
-- the ON CONFLICT (template_name) target the pre-deploy code relies on — so apply it together with the
-- multi-account code.

alter table public.whatsapp_template_settings
  add column if not exists waba_id text;
