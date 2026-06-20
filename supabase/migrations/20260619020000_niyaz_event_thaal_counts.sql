-- Two manually-entered operational thaal numbers per niyaz event (one row per meal in
-- rsvp_registration_instance). They can't be derived from RSVPs — staff enter them via the admin
-- Edit-event modal and reconcile them against the computed Thaals estimate (ceil(yes/8)):
--   thaal_wardi_count = thaals ORDERED (the wardi)
--   actual_count      = thaals ACTUALLY served/used on the day
-- Both nullable (unknown until entered); non-negative when set. RLS already on the table.

alter table public.rsvp_registration_instance
  add column if not exists thaal_wardi_count integer
    check (thaal_wardi_count is null or thaal_wardi_count >= 0),
  add column if not exists actual_count integer
    check (actual_count is null or actual_count >= 0);
