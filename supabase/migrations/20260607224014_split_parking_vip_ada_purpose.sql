-- Split the parking lot purpose 'vip_incapacitated' into separate 'vip' and 'ada' tags.
-- New semantics (see src/lib/parking/rollups.ts matchesLotPurposes):
--   vip = household has a roster category value (VIP, Sahebo, …)
--   ada = household has a rahat-seating or wheelchair member
-- Lots carrying the old combined tag get BOTH new tags so matching behavior is unchanged
-- (a lot that previously matched a household by category OR rahat still matches it).
update public.parking_lots
set
  purposes = array_remove(purposes, 'vip_incapacitated') || array['vip', 'ada'],
  updated_at = now()
where 'vip_incapacitated' = any(purposes);
