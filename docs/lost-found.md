# Lost & Found

Lost & Found captures structured reports from WhatsApp, enriches reporter identity from the
Mumineen roster, automatically escalates lost-item reports, and gives portal members one place to
review both lost and found items.

## Agent behavior

- Informational questions about the process still use `get_site_content_faq`.
- A person reporting something they lost uses `report_lost_item`.
- A person reporting something they found uses `report_found_item`.
- Before reporting, the agent gathers a useful item description and location. If the sender is not
  recognized in Sender Context, it asks for their name and ITS number if available. The API requires
  a reporter name when roster/user enrichment cannot provide one.
- Lost reports automatically call the existing escalation pipeline with category `lost_found` and
  department `Lost and Found`. Found reports do not escalate.
- Both report types tag the conversation intent as `lost_found` and store the Lost and Found
  department on the report.
- Drop-off and pickup guidance is always: go to any help desk in the masjid complex.

## APIs

- `POST /api/lost-found` — WhatsApp-agent intake, identified by `x-whatsapp-from`.
- `GET /api/admin/lost-found` — portal-member list including reporter name, phone, ITS, and resolver info.
- `POST /api/admin/lost-found` — manually add a lost/found item from the portal (any portal member).
- `PUT /api/admin/lost-found/[id]` — edit item details (any portal member).
- `DELETE /api/admin/lost-found/[id]` — remove an item (any portal member).
- `PATCH /api/admin/lost-found/[id]/resolve` — mark an item as resolved/returned. Records the
  portal user who closed it, when, and optional notes.

All routes validate input/authorization before accessing the database. The browser page never
queries Supabase directly.

## Portal page

`/admin/lost-found` appears under the **Mumineen** dropdown and is accessible to every portal
member. It provides:

- **Open / Resolved tabs** — open items show actions (Edit, Delete, Mark Resolved); the Resolved
  tab shows history including who closed it and when.
- **Add Item** button — any portal member can manually add a lost or found report.
- Lost/found type filter, search, counts, item details, location, escalation status, and
  reporter contact details.

## Resolved history

When an item is marked as resolved (found or returned), the system records:
- `resolved_by` — portal user ID who closed it.
- `resolved_by_name` — display name snapshot for the Resolved tab.
- `resolved_at` — timestamp of resolution.
- `resolved_notes` — optional free-text note (e.g. "Returned at help desk 2").

## Data and privacy

`lost_found_reports` stores a reporter snapshot (`reporter_name`, `reporter_phone_e164`,
`reporter_its`) plus linked `whatsapp_users` / `mumineen` IDs when available. This preserves the
report's operational contact details even if roster data changes later. Every report is tagged to
the `Lost and Found` department. Resolution history is tracked via `resolved_by`, `resolved_by_name`,
`resolved_at`, and `resolved_notes`. The table has RLS enabled, is accessed only through server APIs,
and is never exposed to public/visitor reads.

A single sample record is seeded by the migration so new portal users can understand the interface
immediately.
