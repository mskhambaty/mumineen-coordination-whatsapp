-- Drop the legacy per-family rsvp_responses table. It was superseded by the per-mumin niyaz_rsvp
-- table and left empty; its only writers were the admin manual-entry routes
-- (/api/admin/niyaz/responses[, /[id]]), which are removed alongside this migration and were not
-- wired to any UI. No view, RPC, or other reader references it (verified). niyaz_rsvp and
-- niyaz_family_headcount are the system of record going forward.

drop table if exists public.rsvp_responses cascade;
drop function if exists public.set_rsvp_responses_updated_at() cascade;
