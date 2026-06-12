-- Backfill mumin_phone_links from mumineen.whatsapp_e164.
--
-- Context: phone→family resolution (resolveFamilyForPhone, getSenderProfile) keys off
-- mumin_phone_links. Registration creates those links, but roster-seeded WhatsApp numbers that
-- never went through the in-app registration form (or HOF-only registrations) left ~800 submitted
-- members with a whatsapp_e164 on their roster row but no link — so when they messaged the bot for a
-- meal RSVP they were wrongly treated as "unregistered". This one-time backfill creates an
-- 'inferred' link for every active roster member who has a usable WhatsApp number, deduped against
-- existing links by the (phone_e164, mumin_id) unique constraint. The runtime resolvers also gained a
-- whatsapp_e164 fallback, so this keeps the link table consistent for any other consumer.

INSERT INTO public.mumin_phone_links (phone_e164, mumin_id, source, is_primary)
SELECT
  '+' || regexp_replace(m.whatsapp_e164, '[^0-9]', '', 'g') AS phone_e164,
  m.id AS mumin_id,
  'inferred' AS source,
  false AS is_primary
FROM public.mumineen m
WHERE m.whatsapp_e164 IS NOT NULL
  AND m.roster_active IS DISTINCT FROM false
  -- only plausible E.164 numbers (10–15 digits after stripping non-numerics)
  AND length(regexp_replace(m.whatsapp_e164, '[^0-9]', '', 'g')) BETWEEN 10 AND 15
ON CONFLICT (phone_e164, mumin_id) DO NOTHING;
