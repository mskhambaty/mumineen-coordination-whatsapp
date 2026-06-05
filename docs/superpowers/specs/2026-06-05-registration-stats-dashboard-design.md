# Registrations Page — Design

**Date:** 2026-06-05
**Status:** Approved

## Purpose

Internal department teams need self-serve visibility into mumineen registrations:

- **Accommodation**: hotel vs host-family (utaro) split, per-hotel family/person counts, utaro requests
- **Mawaid & Flow**: total registered, rahat/wheelchair needs, age buckets, men vs women
- **Parking/Transport**: rental vs rideshare vs riding-with-host counts for parking pass planning

The page is framed around the **registrations themselves**: one first-class searchable table of registered families (expandable to their members), with stat cards on top that act as **filters** into that table. A single read-only page serves all departments. Per-department pages were rejected: all dept leads are trusted to see everything, the data overlaps across teams, and separate pages only add navigation overhead. Repurposing `/admin/mumineen` was rejected: that page is operational (import, edit, cancel/reopen, WhatsApp gate toggle) with a narrow audience; widening it would require auditing/gating every control.

**Out of scope (separate future sessions):**

- **Parking pass management** — issuing/tracking passes (1 per household, extras as needed, color-coded lots, printed for local hosts and rental mehman welcome kits). This page's household-level transport view is its data source/jump-off.
- **Utaro matching** — matching mehman awaiting utaro with local host offers collected via Google Form (capacity, bedrooms/bathrooms, mardo/bairo preference, pets, sahebo willingness, transport offer). Will need a host-offers table + import + assignment workflow. This page's "awaiting utaro" pool and derived hosts view (below) are its two inputs on the guest side.

## Route & Access

- New page: `src/app/admin/registrations/page.tsx`, route `/admin/registrations`
- Nav: "Registrations" entry in `AdminNav`, grouped near Mumineen Roster
- New check in `src/lib/admin/access.ts`:
  `canViewRegistrations(user)` = `isAdminOrLeadership(user) || user.is_manager === true`
  (dept PMs/HODs carry `is_manager`)
- Read-only page — no mutations
- `/admin/mumineen` is untouched

## Data Flow

One API route: `GET /api/admin/registrations` (gated by `canViewRegistrations`). Returns row-level data with only the columns the page needs; the client computes all aggregates and does all filtering. Rationale: a few thousand rows max, every count derives from the same rows the table shows, filtering is instant, no second endpoint, CSV export is client-side.

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
    openToUtaro: boolean            // hotel-booked but wants a host ("awaiting utaro")
    utaroHostName: string | null
    utaroHostIts: string | null
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

- **Registration funnel** counts all active families by `registration_status` (including not-started); clicking a funnel stage filters the table to those families.
- **All other stats** (demographics, accommodation, transport) count only families with status `submitted` or `confirmed` — accommodation/transport data doesn't exist before submission. The table defaults to submitted + confirmed.
- `not_attending` members excluded everywhere.

## Page Layout

Stats on top, registrations table below. Reuse the `Metric` / `Panel` / `BarRows` visual patterns from `src/app/admin/page.tsx` (no chart library).

### Stat groups (top of page — every stat is a filter)

1. **Overview & Demographics** (Mawaid / Flow)
   - Registration funnel: families by status (not started → in progress → submitted → confirmed, plus cancelled — the cancel/reopen flow sets `registration_status = 'cancelled'`)
   - Total registered people; local vs mehman split
   - Gender split (M / F)
   - Age buckets: **kids < 18** (via `is_adult`), **adults 18–64**, **seniors 65+** (via `age`)
   - Needs: rahat seating count, wheelchair count, special-needs count (non-empty `special_needs`)
2. **Accommodation**
   - Hotel vs utaro split — families and people
   - **Awaiting utaro**: hotel families with `open_to_utaro = true` (the future matching pool) — families and people
   - Per-hotel breakdown (`hotel_name`): families and people per hotel, with an inline "awaiting utaro" count per hotel (how many of that hotel's families/people checked `open_to_utaro`). Clicking the hotel filters the table to its families; clicking its awaiting-utaro count filters to just the open-to-utaro ones.
   - **Hosts** breakdown, derived from guest registrations: utaro families grouped by host (`utaro_host_its` when present, else normalized `utaro_host_name`) — each host with the families/people staying with them. This is the guest-reported view of which local families are hosting; the future matching feature replaces/augments it with the Google Form host-offer data.
3. **Transport** (Parking)
   - `transport_mode` breakdown: rental / rideshare / commute with host / other
   - Counted by **household** (primary, since passes are per-household) and by people

### Registrations table (heart of the page)

One searchable table of families, each row expandable to show its members.

- **Family row columns**: HOF name, HOF ITS, family size, registration status, accommodation (Hotel: *name* / Utaro: *host name*), transport mode
- **Expanded member rows**: name, ITS, age, gender, local/mehman, rahat seating, wheelchair, special needs
- **Search box**: filters by HOF name, HOF ITS, or member name/ITS
- **Filtering via stats**: clicking any stat card or bar row filters the table to its underlying rows; the active filter is shown as a dismissible chip
  - *Family-level stats* (funnel stage, acc type, specific hotel, transport mode) → table shows matching families
  - *Member-level stats* (gender, age bucket, rahat, wheelchair, special needs, local/mehman) → table shows families containing ≥1 matching member, auto-expanded to the matching members
- **Download CSV** button exports the current filtered view (family-level export, or member-level when a member filter is active), client-side

## Testing / Verification

Manual: cross-check totals against the stats cards on `/admin/mumineen` and spot-check known families. No automated tests (consistent with existing admin pages).

## Decisions Log

| Decision | Choice |
|---|---|
| Hub vs per-dept pages | Single hub (Approach A) |
| Framing | Registrations page — first-class family table, stats act as filters (not stats-with-drilldowns) |
| Audience | Dept PMs/HODs self-serve via `is_manager`, plus admin/leadership |
| Access scope | Everyone sees all sections |
| Depth | Counts + filterable table of families/members + CSV export |
| Senior cutoff | 65+ |
| Population | Submitted + confirmed (funnel shows all) |
| Utaro request signal | `open_to_utaro` on hotel families (by design: mehman without self-arranged utaro book a refundable hotel + check the box) |
| Hosts view | Derived from guest-side `utaro_host_*` fields; no host-offer table yet |
| Parking pass mgmt | Separate future feature |
| Utaro matching | Separate future feature (host-offer import + assignment workflow) |
