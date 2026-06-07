# Plan: Accommodations Matching Module

API-first Internal admin module for host-family utaro supply, awaiting-utaro guest demand, and persisted guest-host matching with capacity tracking.

## Spreadsheet Column Mapping (finalized)

| Header | DB Column | Type |
|--------|-----------|------|
| ITS / HOF | hof_its | text (upsert key) |
| First | first_name | text |
| Middle | middle_name | text |
| Last | last_name | text |
| POC | poc | text |
| Status | status | text |
| Mobile | mobile | text |
| Address | address | text |
| City | city | text |
| Pincode | pincode | text |
| Can you provide utaro... | can_provide_utaro | text (normalized to bool for eligibility) |
| How many mehman... | capacity_mehman | integer |
| How many bedrooms... | bedrooms_mehman | integer |
| How many bathrooms... | bathrooms_mehman | integer |
| How many family/friends... | capacity_family_friends | integer |
| Willing to provide utaro for Sahebo... | sahebo_preference | text |
| Preference for mardo or bairo? | gender_preference | text |
| How many days after Ashura... | days_after_ashura | integer |
| Type of Pet | pet_type | text |
| Number Allocated | number_allocated | integer |

## Steps

1. Supabase migration: accommodation_host_imports, accommodation_hosts, accommodation_matches tables with RLS.
2. Host import parser (src/lib/accommodations/import.ts): XLSX, Yes/Y normalization, upsert by hof_its, raw JSON preserved.
3. Guest/host rollups (src/lib/accommodations/rollups.ts): guest = registered hotel families open_to_utaro with total members, ages CSV, M/F counts, submitted_at, mobility. Host = capacity remaining, address, roster demographics when ITS maps to roster.
4. Geocoding fields stored (lat, lon, geocoded_at, geocode_source). Haversine to Masjid 10S252 Kingery Hwy Willowbrook IL 60527 when available.
5. Matching logic (src/lib/accommodations/matching.ts):
   - Hard constraint: entire guest family fits in host remaining capacity.
   - Only CONFIRMED matches reduce host capacity; pending matches do NOT.
   - Rank: submitted_at FIFO, then proximity, then demographics/mobility, then gender_preference alignment.
   - NOT used in matching: sahebo_preference, days_after_ashura, pet_type, bedrooms_mehman, bathrooms_mehman (stored only).
6. Admin API routes (src/app/api/admin/accommodations/**): hosts import/list, guests/awaiting, matches suggest/CRUD/confirm.
7. Match lifecycle:
   - Matching creates records with status=pending. No side effects on families table, no capacity deduction.
   - Admin confirms -> status=confirmed -> deduct host capacity -> update guest families.utaro_* fields -> audit previous values.
8. Admin page (src/app/admin/accommodations/page.tsx): upload hosts, host supply table, awaiting guests table, suggestions, match controls, include-family/friends checkbox (default false).
9. Tests: import parsing, Yes/Y normalization, capacity math, rollups, matching ranking, entire-family constraint, confirm reduces capacity.
10. Docs: admin-dashboard.md, database.md, index.md, openapi.yaml.

## Key Decisions

- Module label: Accommodations (under Internal menu)
- Host identity: ITS/HOF number
- Matching creates pending linkage only; families record updated ONLY on admin confirm
- Only confirmed matches count against host capacity
- Family/friends capacity optional via checkbox, default false
- Matching factors: submitted_at, proximity, demographics/mobility, gender_preference
- NOT matching factors: sahebo_preference, days_after_ashura, pet_type, bedrooms, bathrooms
- Host roster demographics derived when ITS maps to roster: ages, gender mix, mobility, family size
- Awaiting-utaro source: 31-family query (registered/confirmed hotel + open_to_utaro, no HoF-only filter)

## Files to Create/Modify

- NEW: src/lib/accommodations/import.ts
- NEW: src/lib/accommodations/rollups.ts
- NEW: src/lib/accommodations/matching.ts
- NEW: src/app/api/admin/accommodations/ (hosts, guests, matches routes)
- NEW: src/app/admin/accommodations/page.tsx
- NEW: supabase/migrations/YYYYMMDD_accommodations.sql
- NEW: src/lib/__tests__/accommodations-*.test.ts
- MODIFY: src/components/admin/AdminNav.tsx (add link)
- MODIFY: src/lib/admin/access.ts (add access fn)
- MODIFY: docs/admin-dashboard.md, docs/database.md, docs/index.md, docs/openapi.yaml
