# Meal RSVP · Feedback · Daily Department Digest · Send Console

One system across three concerns for the days of Ashara: capturing jaman (meal) RSVPs and
experience feedback over WhatsApp, rolling them up into a nightly per-department briefing, and a
manual console for broadcasting approved templates.

## 1. Niyaz RSVP (jaman) — per-mumin

RSVP is tracked **per mumin per event** in `niyaz_rsvp`: a default attendance baseline is seeded from
each person's arrival date, and the WhatsApp button / head-count templates (§1a) override it as
responses come in.

- **Events** live in `rsvp_registration_instance` (`title`, `event_date`, `hijri_date`, `meal`
  `lunch`|`dinner`, `serving_type` `thaal`|`packet`, `description`, unique `(event_date, meal)`).
  Ashara 1448H = **20 events**: **Pehli Raat (Jun 14, dinner thaal)**, **1st Moharram lunch +
  2nd Moharram dinner (Jun 15)**, **2nd–9th lunch + 3rd–10th dinner (Jun 16–23)**, **Ashura (Jun 24,
  dinner thaal)**. Hijri night-first ordering: lunch = Nth Day, dinner = (N+1)th Night on each
  Gregorian day. (Corrected in `20260610110000_fix_moharram_dates_and_titles` and
  `20260610140000_fix_moharram_dinner_titles`.)
- **`niyaz_rsvp`** (`20260608131000_*`): one row per `(registration_instance_id, mumin_id)` with
  `attending boolean`, `family_id`, and `source` (`default`|`registration`|`whatsapp`|`admin`). RLS
  on, service-role access only. `rsvp_responses` is retired (left empty) for the meal flow.
- **Default rule** (America/Chicago calendar date): `not_attending` ⇒ No; no `arrival_at` ⇒ Yes
  (present all of Ashara, e.g. locals); else Yes when `event_date ≥ arrival date`. Seeded by the
  backfill (`20260609140000_*`, all registered active mumineen × the 20 events) and by the
  `seed_family_niyaz_rsvp(family)` SQL function, which the registration submit/edit calls
  (`src/app/api/register/route.ts`). The function recomputes only `default`/`registration` rows, never
  clobbering a `whatsapp`/`admin` override — so button/head-count responses refine the baseline.
- **Adult/kid/family + thaal counts** come from the **`niyaz_event_tallies`** view
  (`20260608133000_*`): per event, yes/no split by `mumineen.is_adult` (null = adult) and by family,
  plus `thaal_count = ceil(attending heads / 8)`. A **min-mode** function
  `niyaz_event_tallies_min()` (`20260610130000_*`) counts only `whatsapp`/`admin`-sourced RSVPs.
- **Unregistered RSVPs** (`unregistered_rsvps`, `20260610120000_*`): one row per
  (phone, event), `adults`/`kids` counts, optional `its_number`/`family_name`. Recorded when an
  unlinked phone taps a button or the agent records their RSVP. Tallied alongside registered counts.
  Unlike registered families there is **no pre-seeded baseline**, so the agent must send the FULL
  picture — a `{attending:true, all:true}` baseline plus any `{attending:false, …}` exceptions — in
  one `set_family_meal_rsvps` call. `recordUnregisteredRsvp` resolves the entries through the shared
  `decideEvents` (last entry wins per event), so a meal-scoped "not attending" is stored as
  `attending=false` and `adults`/`kids`/`its_number` are written on every resolved row (and omitted
  from the upsert when not supplied, so a later partial update can't clobber them).
  **Auto-merge on registration:** when a family registers (or edits) via `/api/register`, any
  `unregistered_rsvps` matching the family's phone numbers are converted into confirmed `niyaz_rsvp`
  rows (`source='whatsapp'`) and the unregistered records are deleted (`mergeUnregisteredRsvps`).

**Phone → family resolution** (`src/lib/rsvp/family.ts` `resolveFamilyForPhone`, and the inbox
profile's `getSenderProfile`): checks `mumin_phone_links` first, then **falls back to the roster
member's own `mumineen.whatsapp_e164`**. Registration creates the links, but roster-seeded numbers
(or HOF-only registrations) left ~800 submitted members with a WhatsApp number but no link — so they
were wrongly treated as "unregistered" when messaging the bot. A one-time backfill
(`20260610150000_backfill_mumin_phone_links`) created `source='inferred'` links for every active
roster member with a usable number, and the runtime fallback covers any future gap.

Code: `src/lib/rsvp/family.ts` (phone → roster family), `src/lib/rsvp/meal-rsvp.ts`
(`getFamilyNiyazGrid` — per event, family attending split into **adults/kids** via
`mumineen.is_adult` (null = adult) so the agent reads back "2 adults, 2 kids" not "4 adults";
`getFamilyMembers` — roster-active member list with name/isAdult/isHead/notAttending for the agent
to list when the user's count exceeds the family size;
`setFamilyNiyazRsvp` whole-family cascade, `getEventTallies(mode)`,
`recordUnregisteredRsvp`, `getUnregisteredRsvps`, `recordUnregisteredHeadCount`,
`mergeUnregisteredRsvps`, `getMealAttendanceTotals`). API: `GET/POST /api/rsvp/meals` (self-scoped via `x-whatsapp-from`,
Zod-validated; POST entries are `{attending, dates?, meal?, all?}` with optional `adults`, `kids`,
`its_number` — for registered families, `adults`/`kids` enable **partial attendance**: only that many
members are marked attending (head of family kept first, then other adults, then kids), and the rest
are marked not-attending for those events; for unregistered callers they record the head count.
Changes go to `unregistered_rsvps` for unlinked phones). Agent tools: `get_family_meal_rsvps`, `set_family_meal_rsvps`
(public; the agent mainly records *changes* — guidance in `MEAL_RSVP_FEEDBACK_RULE`). That rule
also routes intent: "register / sign up for Pehli Raat / a Moharram day / Ashura / a jaman" is a
**meal RSVP**, not in-person event registration — the agent must not answer it from the registration
FAQ, and must never tell an already-registered caller (Sender Context: `Registration: submitted`) to
come to the masjid to register again. Admin:
`/admin/niyaz` shows the events sorted by date with **Max/Min tabs** (max = arrival-date defaults,
min = confirmed only — an inline legend on the page spells out each definition + the thaal formula),
registered + unregistered count columns, backed by
`GET /api/admin/niyaz/instances?mode=max|min` (reads the tallies view / function). Clicking an event
opens the **per-mumin responses** view: searchable by name / ITS / phone, with columns for Name,
RSVP, **Source** (a labelled badge — `default`=Seeded from arrival, `registration`, `whatsapp`,
`admin` — so staff can tell a real confirmation from a seeded default) and **Responded by** (the
WhatsApp phone or admin that set it). ITS is searchable but no longer shown as its own column. Below
the registered rows, an **Unregistered guests** table lists `unregistered_rsvps` for that event
(phone, RSVP, adults, kids, ITS) so a guest who RSVP'd before registering is still visible. Both
tables come from `GET /api/admin/niyaz/instances/{id}/responses` (which now returns `responses` +
`unregistered`).

### 1a. Daily button RSVP (individual + family)

RSVP is collected day-by-day via WhatsApp templates with **quick-reply buttons** (Both meals / Lunch
only / Dinner only / Not attending). An admin opens an event on `/admin/niyaz` and **sends** the
template from a composer: pick an **audience** (Specific ITS (test) / All mumineen / All HOF / All
adults), an optional **"only those who haven't responded"** filter, a **level** (Individual = records
the responder; Family = records the whole family), and an approved **template**. The send goes through
the broadcast queue (`POST /api/admin/niyaz/instances/[id]/broadcast` →
`resolveNiyazAudience` + `buildNiyazSend` → `createBroadcast` with explicit `recipients` +
`quickReplyButtons`); a `GET` on the same route previews the recipient count.

Each button's payload is stamped at send time as **`niyaz|<level>|<scope>|<date>`**
(`level ∈ ind|fam`, `scope ∈ both|lunch|dinner|none`). When a mumin taps, the webhook
(`src/app/api/whatsapp/webhook/route.ts`) reads `buttonPayload` (`src/lib/whatsapp/parser.ts`),
resolves the **family/mumin from the sender's phone** (`resolveFamilyForPhone`), records via
`recordNiyazButtonResponse` (`ind` → that mumin; `fam` → whole family, both into `niyaz_rsvp` with
`source='whatsapp'`), sends a **confirmation**, and skips the agent. If the phone is **not linked to
a registered family**, the tap is recorded in `unregistered_rsvps` via `recordUnregisteredRsvp`, a
head-count prompt is created (so the caller can reply with their family size), and a friendlier
confirmation is sent encouraging them to register. The per-event detail panel lists
the recorded responses (`GET /api/admin/niyaz/instances/[id]/responses`, reads `niyaz_rsvp`).
Outbound quick-reply payloads are emitted by `buildSendComponents` (`src/lib/whatsapp/templates.ts`).

The composer also supports a **head-count** mode (free-text family RSVP): pick "Head count" as the
response type and a button-less template (variables `person_name`, `registration_message`,
`family_members`, `example_response`). The send writes a **`niyaz_rsvp_prompts`** row per recipient
(phone → family + date) instead of button payloads. When the family **replies with a number**, the
webhook (`handleNiyazHeadCount`) matches the latest open prompt for that phone, records the count in
**`niyaz_family_headcount`** (per event/family, applied to that day's events) via `recordFamilyHeadCount`,
consumes the prompt, and confirms. The event-detail panel shows these family head counts
(`getFamilyHeadCounts`) alongside the per-mumin button responses. (`niyaz_rsvp_prompts` +
`niyaz_family_headcount`: `supabase/migrations/20260609120000_*`.)

## 2. Feedback

Append-only, department-tagged, sentiment-scored — `feedback_entries`
(`supabase/migrations/20260606100200_*`). Feedback is captured by the **nightly conversation-mining
batch** (see §3), which is the single source — the agent does **not** log feedback in real time
(that caused double-counting and fired rarely). Each entry is associated with **one or more
departments** (`feedback_entries.department_ids uuid[]`) by an LLM classifier against the **live
department list + descriptions** (`classifyDepartments`, `src/lib/departments/classify.ts`) — so a
comment that spans areas ("AC broken and parking chaotic") is credited to every owning department in
the digest — falling back to the static area→department map (`src/lib/feedback/areas.ts`). The
`create_issue` path
uses the same classifier to route issues to the right department when the agent doesn't name one,
so they don't sit untriaged. (`POST /api/feedback` + `recordFeedback` remain as a programmatic
insert path for future admin/manual entry, but are no longer wired to the agent.)

## 3. Nightly department digest (03:00 UTC (10pm Chicago, CDT))

Before aggregating, the cron **mines the last 24h of raw conversations** for feedback
(`src/lib/digest/mine-conversations.ts`) — the single source of digest feedback. This is **batched** —
~10-15 conversations per LLM call, a handful of calls per night — so it uses the higher-end
`OPENAI_MODEL_HIGH` preset (better extraction) rather than looping the cheap model per conversation.
Each call extracts feedback items, assigns sentiment, and routes to a department (live catalog) in
one shot; results are written to `feedback_entries` (`source = 'mined'`, idempotent per day). The
aggregation below then picks them up alongside real-time and admin feedback.


`src/lib/digest/aggregate.ts` rolls up a day's feedback / issues (`tasks`) / escalations
(`conversation_sessions`) per department, plus an all-up view with flagged knowledge gaps and the
next day's meal RSVP totals. `src/lib/digest/run.ts` generates **two** summaries per active
department — a short one-liner (WhatsApp) and a longer bullet list (email + dashboard) — stores both
in `department_daily_summaries` (`ai_briefing` = long, `ai_briefing_short` = short), and distributes:

- **WhatsApp** via the Meta `daily_department_issue_confirmation` template (`{{1}}` department,
  `{{2}}` short summary) — `DEPARTMENT_SUMMARY_WA_TEMPLATE`.
- **Email** via the Postmark `daily-department-summary` template (`department_name`, `feedback_html`
  bullet list, `feedback_text`) — `POSTMARK_DEPARTMENT_SUMMARY_TEMPLATE`.

Recipients opt out via `department_members.daily_feedback_digest` (default **ON**). A user in N
departments gets N messages. The **all-up** summary (one per day, `department_id` null) goes to
admin/leadership plus **Project Management** and **Leadership** department members.

Cron: `/api/cron/department-digest` (03:00 UTC (10pm Chicago, CDT), `?date=` override). Portal: `/admin/department-digest`
+ `GET /api/admin/department-digest`, **access-scoped**: a department member sees only their own
departments' summaries; admin/leadership and Project Management / Leadership members see every
department plus the all-up. Summaries are stored per day for historical reference.

## 4. Manual Send Templates console

`/admin/whatsapp-templates` (External nav, **admin/leadership only**, server-gated by
`requireAdminLeadership`). Pick an approved template, pick an audience, preview free/paid counts +
cost, send. No auto-scheduling — every send is a button press.

- Audiences (`src/lib/whatsapp/audience.ts`), always **deduped by phone**: `selected_users`,
  `chicago_committee`, `arrived_hof`, `registered_hof`, `all_members`, `custom` (rule-tree filter),
  and `csv_upload`. Split into in-window (free) vs out-window (paid) using
  `conversation_sessions.last_message_at`; cost via `WHATSAPP_UTILITY_MSG_COST_USD`.
- `csv_upload` (`src/lib/whatsapp/audience-csv.ts`): audience taken from an uploaded CSV in the **same
  format as the app's CSV downloads** (the audience export, or a broadcast's failures export). Columns
  matched by header (case-insensitive, order-free); a `WhatsApp` column is required; the roster columns
  (`Name`, `ITS`, `Jamaat`, …) are carried as per-recipient `fields` for personalization; `Window`,
  `Reason`, and unknown columns are ignored; rows deduped by number. Parsed server-side via the shared
  `parseCsv` util and passed as raw `csv` text to `POST /preview` and `POST /send`. Missing fields are
  **enriched from the roster by phone** (`enrichFieldsByPhone` → `resolveRosterByPhone`: direct
  `whatsapp_e164` match + `mumin_phone_links` fallback), so a name-mapped template variable resolves for
  any recipient on the roster even when their uploaded row left Name blank — CSV-provided values still
  win; numbers not on the roster stay blank and are skipped by field-mapped templates. **Excel guard:**
  phone cells serialized as scientific notation (`9.17869E+11`) are unrecoverable, so they're flagged
  as `corrupted` and skipped (never messaged) — the preview reports the count. Not DB-resolved — it
  flows through the explicit-`recipients` path in `createBroadcast` (`resolveAudience` throws for this
  key as a guard); `audience-export` returns 400 for `csv_upload`.
- Engine (`src/lib/whatsapp/broadcast.ts`): a broadcast enqueues recipients; the send route then drains
  **inline until the queue is empty** (`drainUntilEmpty`, a bounded loop) so small/medium sends complete
  in-request. `/api/cron/broadcast-drain` (every minute) is a backstop for large sends, and
  `POST /api/admin/templates/drain` ("Send pending" in the console) lets an admin push pending recipients
  manually — so a broadcast never silently hangs in `running` when the cron isn't firing. Throttled
  batches go through the shared `sendTemplateNotification` pipeline; logged in `template_broadcasts` /
  `template_broadcast_recipients`.
- Delivery status: the WhatsApp webhook applies Meta `delivered`/`read`/`failed` callbacks by
  `wa_message_id` and marks `replied` when a target messages back (`src/lib/whatsapp/broadcast-status.ts`).
  When a `failed` callback carries a Meta `errors[]` entry, its `code: title` (plus a plain-language
  hint for common codes, e.g. `131049` engagement/frequency cap, `131026` undeliverable) is stored in
  the recipient's `error_detail` — never any PII. Most large-broadcast failures are Meta *delivery*
  decisions reported async (not send-time rejections), so this is the only place the real reason exists.
- Failure visibility: send-time and delivery-status failures are surfaced per broadcast in the console —
  expand a Broadcast-log row for the status rollup + a grouped failure-reason breakdown
  (`failure_reasons` on `GET .../broadcasts/[id]`), with a per-recipient list / CSV from
  `GET .../broadcasts/[id]/failures` (admin/leadership only; PII to authorized staff, never to visitors).
  The reason shown is `error_detail` when present (the captured Meta code/title); the free/paid
  24h-window label is only a fallback for failures Meta reports with no error detail (`categorizeFailure`).
  The per-recipient Name/ITS are resolved via the shared `resolveRosterByPhone` (direct + the
  `mumin_phone_links` fallback), so they populate for any failed number that maps to a roster member.
- API: `GET /api/admin/templates`, `POST /api/admin/templates/preview`, `POST .../send`,
  `POST .../drain`, `GET .../broadcasts(/[id])`, `GET .../broadcasts/[id]/failures`.

The console handles **no-variable** templates to audiences; the older single-recipient composer
(`/admin/whatsapp`, free-text + variable templates) remains for those cases. Full consolidation is
a follow-up.

## Permissions / privacy

All new API routes are authorized: agent routes by `x-whatsapp-from` (self-scoped), admin routes by
`requireAdminKey`, and the send console by `requireAdminLeadership` (admin key **and** DB-verified
admin/leadership). RLS is enabled on every new table. Phone numbers live only in the DB and are
never returned by preview/log endpoints or logged.
