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
- `GET /api/admin/lost-found` — portal-member list including reporter name, phone, and ITS.

Both routes validate input/authorization before accessing the database. The browser page never
queries Supabase directly.

## Portal page

`/admin/lost-found` appears under the **Mumineen** dropdown and is accessible to every portal
member. It shows lost/found counts, filtering/search, item details, location, escalation status,
and reporter contact details.

## Data and privacy

`lost_found_reports` stores a reporter snapshot (`reporter_name`, `reporter_phone_e164`,
`reporter_its`) plus linked `whatsapp_users` / `mumineen` IDs when available. This preserves the
report's operational contact details even if roster data changes later. Every report is tagged to
the `Lost and Found` department. The table has RLS enabled, is accessed only through server APIs,
and is never exposed to public/visitor reads.
