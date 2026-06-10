-- Fix WhatsApp numbers the roster importer mis-normalized to +1.
--
-- rosterPhoneToE164 assumed every bare 10-digit number was US (Chicago) and prepended +1. That
-- corrupted foreign 10-digit numbers: India (POONA / MUMBAI / DOHAD) families were stored as
-- +1<10 digits> instead of +91<10 digits>, and one North Chicago number was stored as
-- +7739979800 (a +7 / Russia number) instead of +17739979800. The mumin_phone_links backfill then
-- propagated the bad roster values into the link table, so these members had no link matching the
-- number they actually message from — i.e. the bot treated them as unregistered.
--
-- Ground truth: mumin 39978b30 messaged the bot from +919821566165, confirming the +91 correction
-- for the Mumbai/Poona/Dohad families. The 773 number is unambiguous US (NANP area code 773,
-- jamaat NORTH CHICAGO, IL). Foreign Singapore (+65) numbers are intentionally left alone: their
-- `registration` link already carries the correct full E.164 and matches inbound.
--
-- Keyed on mumin id (surgical — cannot touch any other record). Rebuilds exactly one correct link
-- per member from the corrected roster value, dropping the superseded wrong links (both the +1
-- `inferred` link and the country-code-less `registration` link).

-- 1. Correct the roster numbers.
UPDATE public.mumineen SET whatsapp_e164 = '+919979188963' WHERE id = 'd2acc3a2-b97b-4b49-9bd1-418dee450f20';
UPDATE public.mumineen SET whatsapp_e164 = '+919821566165' WHERE id = '39978b30-6a7b-42ab-81fe-59a71bd23aa4';
UPDATE public.mumineen SET whatsapp_e164 = '+919819978652' WHERE id = '6b61e2f3-16ca-4b39-8711-0480e081aace';
UPDATE public.mumineen SET whatsapp_e164 = '+919822988852' WHERE id IN (
  '163fc93e-3ac1-4b33-a908-684869ea93c0',
  '648236d7-acb8-4f0d-ad7b-8e798a099fb7',
  '64a7a6e3-a638-4008-9e3b-8c2a9a1dd99e',
  '77b2fe11-3add-4d02-9b5b-2d08f8ea41b9',
  'aa948694-9488-42da-bc94-d07881a1a32c'
);
UPDATE public.mumineen SET whatsapp_e164 = '+17739979800' WHERE id = '9dd19f2d-8d34-4c44-8999-06fa1b02fa22';

-- 2. Drop all existing (wrong) links for these members.
DELETE FROM public.mumin_phone_links WHERE mumin_id IN (
  'd2acc3a2-b97b-4b49-9bd1-418dee450f20',
  '39978b30-6a7b-42ab-81fe-59a71bd23aa4',
  '6b61e2f3-16ca-4b39-8711-0480e081aace',
  '163fc93e-3ac1-4b33-a908-684869ea93c0',
  '648236d7-acb8-4f0d-ad7b-8e798a099fb7',
  '64a7a6e3-a638-4008-9e3b-8c2a9a1dd99e',
  '77b2fe11-3add-4d02-9b5b-2d08f8ea41b9',
  'aa948694-9488-42da-bc94-d07881a1a32c',
  '9dd19f2d-8d34-4c44-8999-06fa1b02fa22'
);

-- 3. Recreate one correct link per member from the corrected roster value.
INSERT INTO public.mumin_phone_links (phone_e164, mumin_id, source, is_primary)
SELECT m.whatsapp_e164, m.id, 'inferred', false
FROM public.mumineen m
WHERE m.id IN (
  'd2acc3a2-b97b-4b49-9bd1-418dee450f20',
  '39978b30-6a7b-42ab-81fe-59a71bd23aa4',
  '6b61e2f3-16ca-4b39-8711-0480e081aace',
  '163fc93e-3ac1-4b33-a908-684869ea93c0',
  '648236d7-acb8-4f0d-ad7b-8e798a099fb7',
  '64a7a6e3-a638-4008-9e3b-8c2a9a1dd99e',
  '77b2fe11-3add-4d02-9b5b-2d08f8ea41b9',
  'aa948694-9488-42da-bc94-d07881a1a32c',
  '9dd19f2d-8d34-4c44-8999-06fa1b02fa22'
)
ON CONFLICT (phone_e164, mumin_id) DO NOTHING;
