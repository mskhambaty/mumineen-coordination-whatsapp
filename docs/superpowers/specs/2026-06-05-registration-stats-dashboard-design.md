# Registration Stats Hub — Design

**Date:** 2026-06-05
**Status:** Approved

## Purpose

Internal department teams need self-serve visibility into mumineen registration data:

- **Accommodation**: hotel vs host-family (utaro) split, per-hotel family/person counts, utaro requests
- **Mawaid & Flow**: total registered, rahat/wheelchair needs, age buckets, men vs women
- **Parking/Transport**: rental vs rideshare vs riding-with-host counts for parking pass planning

A single read-only dashboard page serves all departments. Per-department pages were rejected: all dept leads are trusted to see everything, the data overlaps across teams, and separate pages only add navigation overhead. Repurposing `/admin/mumineen` was rejected: that page is operational (import, edit, cancel/reopen, WhatsApp gate toggle) with a narrow audience; widening it would require auditing/gating every control.

**Out of scope:** Parking pass management (issuing/tracking passes — 1 per household, extras as needed, color-coded lots, printed for local hosts and rental mehman welcome kits) is a separate future feature. This dashboard's household-level transport drill-down is its natural data source/jump-off.

## Route & Access

- New page: `src/app/admin/registration-stats/page.tsx`, route `/admin/registration-stats`
- Nav: "Registration Stats" entry in `AdminNav`, grouped near Mumineen Roster
- New check in `src/lib/admin/access.ts`:
  `canViewRegistrationStats(user)` = `isAdminOrLeadership(user) || user.is_manager === true`
  (dept PMs/HODs carry `is_manager`)
- Read-only page — no mutations
- `/admin/mumineen` is untouched

## Data Flow

One API route: `GET /api/admin/registration-stats` (gated by `canViewRegistrationStats`). Returns row-level data with only the columns the dashboard needs; the client computes all aggregates. Rationale: a few thousand rows max, every count derives from the same rows it drills into, drill-downs are instant, no second endpoint, CSV export is client-side.

Response shape:

```ts
{
  families: Array<{
    id: string
    hofIts: string
    hofName: string | null          // joined from head mumin
    registrationStatus: 'not_started' | 'in_progress' | 'submitted' | 'confirmed'
    memberCount: number             // active, attending members
    accType: 'hotel' | 'utaro' | null
    hotelName: string | null
    utaroHostName: string | null
    transportMode: 'rideshare' | 'rental' | 'commute_with_utaro' | 'other' | null
    transportDetail: string | null
  }>
  members: Array<{
    its: string
    familyId: string
    fullName: string
    gender: 'M' | 'F' | null
    age: number | null
    isAdult: boolean
    localMehman: string | null      // local vs mehman classification
    rahatSeating: boolean
    wheelchair: boolean
    specialNeeds: string | null
  }>
}
```

Filters applied server-side: `roster_active = true`, `not_attending` members excluded.

## Population Rule

- **Overview funnel** counts all active families by `registration_status` (including not-started).
- **All other stats** (demographics, accommodation, transport) count only families with status `submitted` or `confirmed` — accommodation/transport data doesn't exist before submission.
- `not_attending` members excluded everywhere.

## Page Layout

Three anchored sections on one page, all visible to every authorized user. Reuse the `Metric` / `Panel` / `BarRows` visual patterns from `src/app/admin/page.tsx` (no chart library).

### 1. Overview & Demographics (Mawaid / Flow)

- Registration funnel: families by status (not started → in progress → submitted → confirmed)
- Total registered people; local vs mehman split
- Gender split (M / F)
- Age buckets: **kids < 18** (via `is_adult`), **adults 18–64**, **seniors 65+** (via `age`)
- Needs: rahat seating count, wheelchair count, special-needs count (non-empty `special_needs`)

### 2. Accommodation

- Hotel vs utaro split — families and people
- Per-hotel breakdown (`hotel_name`): families and people per hotel
- Utaro list: families with host names

### 3. Transport (Parking)

- `transport_mode` breakdown: rental / rideshare / commute with host / other
- Counted by **household** (primary, since passes are per-household) and by people

## Drill-down

Clicking any metric or bar row expands an inline table below that section (not a modal) listing the underlying rows:

- Family-level drill-downs (funnel, accommodation, transport): HOF name, HOF ITS, family size, plus section-relevant columns (hotel name / host name / transport mode + detail)
- Member-level drill-downs (demographics, needs): name, ITS, age, gender, HOF, plus the relevant flag/text

Each drill-down table has a **Download CSV** button (client-side generation from the same data).

## Testing / Verification

Manual: cross-check totals against the stats cards on `/admin/mumineen` and spot-check known families. No automated tests (consistent with existing admin pages).

## Decisions Log

| Decision | Choice |
|---|---|
| Hub vs per-dept pages | Single hub (Approach A) |
| Audience | Dept PMs/HODs self-serve via `is_manager`, plus admin/leadership |
| Access scope | Everyone sees all sections |
| Depth | Counts + drill-down lists + CSV export |
| Senior cutoff | 65+ |
| Population | Submitted + confirmed (funnel shows all) |
| Parking pass mgmt | Separate future feature |
