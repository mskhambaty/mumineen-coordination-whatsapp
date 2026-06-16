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
  on, service-role access only. (The legacy `rsvp_responses` table was dropped in
  `20260614120000_drop_rsvp_responses` — it had been left empty after `niyaz_rsvp` replaced it.)
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
  Unlike registered families there is **no pre-seeded baseline**. The agent ALWAYS defaults
  unregistered callers to all days attending — even if the caller only mentions one event (because
  in the Ashara context, that almost certainly means all days). So every `set_family_meal_rsvps`
  call starts with a `{attending:true, all:true}` baseline plus any `{attending:false, …}`
  exceptions. After recording, the agent shows the full grid and asks the caller to confirm. `recordUnregisteredRsvp` resolves the entries through the shared
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
(`getFamilyNiyazGrid` — per **meal-event** family attending count plus an adults/kids split via
`mumineen.is_adult` (null = adult); still used for the partial-attendance allocation and as the input
to the per-day view. `getFamilyNiyazDays` — the **per-DAY** view the bot reads back: groups the grid by
Gregorian `event_date` into one row per day, each carrying a single `attending` count for `lunch` and
for `dinner` (or null when that meal isn't served), plus a day `title`. `groupEventsByDay` is the pure,
testable grouping helper; the day `title` comes from `niyaz_event_config.rsvp_event_title` (via
`getEventConfigTitles` in `event-config.ts`) so it matches the admin **Niyaz days** view — NOT the
per-meal instance title, which differs on dinners due to the hijri night-shift (fallback: config
title → lunch instance title → dinner instance title → date);
`getFamilyMembers` — roster-active member list with name/isAdult/isHead/notAttending for the agent
to list when the user's count exceeds the family size;
`setFamilyNiyazRsvp` whole-family cascade, `getEventTallies(mode)`,
`recordUnregisteredRsvp`, `getUnregisteredRsvps`, `recordUnregisteredHeadCount`,
`mergeUnregisteredRsvps`, `getMealAttendanceTotals`). API: `GET/POST /api/rsvp/meals` (self-scoped via `x-whatsapp-from`,
Zod-validated; returns a today→Ashura `days` array `[{date, dateLabel, title, lunch, dinner}]` (lunch/dinner
each `{attending,total}` or null); POST entries are `{attending, titles?, dates?, meal?, all?}` with optional `adults`, `kids`,
`its_number`. **Event targeting:** because the summary is day-based, the agent now targets a change by the
day row's `date` + `meal` — copying the server-provided `date` **verbatim** (never computing it). Since
`(event_date, meal)` is unique, this hits exactly one jaman, so the displayed day title is presentation-only
and never a write selector — eliminating any hijri night-shift mis-target. `titles`+`meal` remains accepted
server-side as a legacy fallback (`decideEvents` resolves title→date). For registered families, `adults`/`kids` enable **partial attendance**: only that many
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
webhook (`handleNiyazHeadCount`) matches the latest open prompt for that phone and calls
`recordFamilyHeadCount`, consumes the prompt, and confirms.

`recordFamilyHeadCount` **materializes the number into `niyaz_rsvp`** — the single source of truth —
by allocating that many attending members across the family (head → adults → kids, clamped to roster
size; the clamp is surfaced in the reply so extras are nudged to register). It also upserts the raw
number into **`niyaz_family_headcount`** purely as an audit record of what the family literally said;
that table is display-only (`getFamilyHeadCounts`) and is **never summed into the event tallies** —
the attendance it represents is already counted in `niyaz_rsvp`, so adding it would double-count.
(`niyaz_rsvp_prompts` + `niyaz_family_headcount`: `supabase/migrations/20260609120000_*`.)

### 1b. Double-RSVP via WhatsApp Flow (`ashara_relay_double_rsvp`)

**Niyaz days vs Niyaz events.** The admin UI separates configuration from responses:
- **Niyaz days** (`/admin/niyaz/days`) — the day-level config in `niyaz_event_config` (keyed by
  `event_date`), **prefilled 1st–10th Moharram** (`20260615190000_seed_niyaz_days`): `rsvp_event_title`,
  `lunch_menu`, `dinner_menu`, `rsvp_end_time`, `has_lunch`/`has_dinner` checkboxes, `template_code`.
  This is where each day is configured **and the RSVP is sent** (`EventRsvpComposer`). Listed via
  `GET /api/admin/niyaz/days`; edited via `GET/PUT /api/admin/niyaz/days/[date]`
  (`src/lib/rsvp/event-config.ts`). The page maps each day to a **representative registration
  instance** for that date to drive the broadcast.
- **Niyaz events** (`/admin/niyaz`) — the per-meal `rsvp_registration_instance` rows, which remain the
  RSVP/tally source of truth; clicking one shows **only its responses**. A "Niyaz days →" button links
  the two. (`GET/PUT /api/admin/niyaz/instances/[id]/config` still exists as an instance-keyed alias.)

The composer sends `ashara_relay_double_rsvp` (a **Flow** button "Attending" + a "Not attending"
quick-reply) from the niyaz RSVP number (the broadcast WhatsApp account that owns the template).
Body variables auto-bind to the event-config values (`rsvp_event_title` / `lunch_menu` /
`dinner_menu` / `rsvp_end_time`), person fields, or `family_members`. The **button payloads are
specified in the composer** and resolved **per recipient** at send time via `resolveBindings` —
`{{Person.Id}}` → mumin id, `{{RegistrationInstanceId}}` → this instance, `{{EligibleFamilyCount}}` →
the family's roster-active, not-attending=false count. `buildSendComponents` emits the Flow button as
`{ sub_type: "flow", parameters: [{ type: "action", action: { flow_token, flow_action_data } }] }`.

**Audiences** (the composer): *All HOF* (one reachable number per family, `roster_active` +
`not_attending=false`, `require_registered=false`) and *All HOF — not yet responded* (the same, minus
families with a `whatsapp`/`admin` `niyaz_rsvp` row for this event). Both have a **preview** (count +
a sample list of name / ITS / masked phone), an **Export CSV** button — `GET …/broadcast?…&format=csv`
streams the *full* resolved audience (Name, ITS, HOF ITS, Jamaat, City, Gender, Local/Mehman, unmasked
WhatsApp; the preview sample is capped at 100, this is every recipient), gated to admin/leadership
since it carries full numbers — and there's a **single-ITS test send**.

**Upload CSV** audience: re-upload a CSV in the *exact export format* (a `WhatsApp` column is required;
Name/ITS/HOF ITS/etc. optional) to broadcast to a hand-trimmed list — e.g. export *All Adults*, delete
rows in a sheet, re-upload. Parsed client-side for the preview (count + sample) and re-parsed server-side
at send (`resolveNiyazCsvRecipients` → `parseAudienceCsv`). Each row is matched back to the roster by its
WhatsApp number so recipients carry the same computed fields a resolved audience would (`family_id`,
`mumin_id`, `hof_its`, `eligible_family_count`) and the per-recipient RSVP buttons still personalize; rows
with no roster match are still sent (CSV fields + `eligible_family_count` 1). CSV upload is **POST-only**
(the file is in the body, not a query param), so it has no GET preview/export — preview is client-side,
and there's no Export button for it. Deduped by number; every recipient is enqueued + delivery-tracked
like any other broadcast.

The flow_token / not-attending payloads use the `rsvp:<hof_its>:<day_id>` shape (`day_id` =
`niyaz_event_config.day_id`, a stable numeric per-day id; the Flow's `registration_instance_id` is
this day_id, not a per-meal instance UUID). flow_action_data carries `hof_its`,
`registration_instance_id` (day_id), and `lunch_attending_count` / `dinner_attending_count`.

**RSVP cutoff:** each day has an `rsvp_end_at` timestamp (set via a datetime field in the composer; the
`{{rsvp_end_time}}` variable renders it in Chicago time). An interactive response arriving **after**
`rsvp_end_at` is **not recorded** — `recordNiyazRsvpFromInteractive` returns `ended` and the webhook
replies "registration has ended". No cutoff set ⇒ always open.

**Inbound (phase 2 — recorded):** Flow completions (`nfm_reply`) and `rsvp:…:not-attending` taps are
captured raw into `whatsapp_interactive_responses` AND decoded into `niyaz_rsvp`
(`recordNiyazRsvpFromInteractive` → `recordNiyazDayRsvp`): resolve family by `hof_its`, day by
`day_id`, then write per meal — `min(count, roster)` members attending (head→adults→kids), and any
**overflow** beyond the roster as **guest** mumineen rows (`roster_active=false`, sentinel ITS
`00000-…`, `full_name='Guest'`) that still count in the tallies. Re-submissions reconcile (idempotent;
guests walk down on a lower count). See [whatsapp-webhook.md](./whatsapp-webhook.md).

**Confirmation template (sent after a response):** each niyaz day also configures a **second**
template — the RSVP confirmation (`ashara_relay_double_rsvp_confirmation`, body vars `{{mumin_name}}`
+ `{{rsvp_status}}`) — with its own variable bindings + button payloads, persisted on
`niyaz_event_config` (`confirmation_template_code` / `confirmation_variable_bindings` /
`confirmation_buttons`). After phase 2 records a response, `sendNiyazConfirmation`
(`src/lib/rsvp/niyaz-interactive.ts`) sends it back to the responder via the single-recipient pipeline:
`mumin_name` ← family head name, `rsvp_status` ← `getNiyazRsvpStatus` (recomputed `Lunch n, Dinner n`
from `niyaz_rsvp`, guests included), and the change-button reopens the RSVP Flow pre-filled with the
current lunch/dinner counts. Fires for both attending and not-attending responses; best-effort (never
blocks the record). Both templates are configured per day in the composer's two
`TemplateBindingEditor` sections; Send saves config first so the confirmation is ready.

**Niyaz inbox:** conversations on the niyaz number are attributed via
`conversation_sessions.phone_number_id` (and `messages.phone_number_id`) and kept **out of the main
inbox**; view them via the **Niyaz inbox** button on `/admin/niyaz` (→ `/admin/conversations?scope=niyaz`).

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
(`conversation_sessions`) / **open tickets** per department, plus an all-up view with flagged
knowledge gaps and the total open ticket count. The per-department `DeptMetrics` includes:
- `feedback` — counts + up to **100 sample comments** (so the AI can identify recurring themes and quantify them)
- `new_issue_samples` — title + priority for up to 10 new issues created that day
- `escalation_samples` — up to 10 escalation reasons
- `open_ticket_details` — title + priority + status for up to 10 open tickets
- `AllUpExtras` includes `total_open_tickets`

`src/lib/digest/run.ts` generates **two** summaries per active
department — a short one-liner (WhatsApp) and a longer bullet list (email + dashboard) — stores both
in `department_daily_summaries` (`ai_briefing` = long, `ai_briefing_short` = short), and distributes:

- **WhatsApp** via the Meta `daily_department_issue_confirmation` template (`{{1}}` department,
  `{{2}}` short summary) — `DEPARTMENT_SUMMARY_WA_TEMPLATE`. Gated by `DIGEST_WHATSAPP_ENABLED=true`
  (default off) to control Meta template quota. When enabled, a summary `template_broadcasts` row
  (`audience_key = 'department_digest'`) is logged for visibility on the `/admin/whatsapp-templates`
  broadcasts page. For the **All Departments** send, `{{2}}` is now a richer multi-line payload:
  headline + a few per-department lines (only departments with issues/open tickets/escalations),
  plus untriaged issue count when present.
- **Email** via the Postmark `daily-department-summary` template (`department_name`, `feedback_html`
  bullet list, `feedback_text`) — `POSTMARK_DEPARTMENT_SUMMARY_TEMPLATE`.

A department is included in the digest when it has any feedback, new issues, **or open tickets** (was
previously feedback + new issues only). The all-up summary includes total open tickets.

The standalone daily task-digest cron (`/api/cron/daily-digest`) and the Ashara translation reminder
email have been removed — open ticket visibility is now part of this nightly digest.

Recipients opt out via `department_members.daily_feedback_digest` (default **ON**). A user in N
departments gets N messages. The **all-up** summary (one per day, `department_id` null) goes to
admin/leadership plus **Project Management** and **Leadership** department members.

Cron: `/api/cron/department-digest` (03:00 UTC (10pm Chicago, CDT), `?date=` override). Portal: `/admin/department-digest`
+ `GET /api/admin/department-digest`, **access-scoped**: a department member sees only their own
departments' summaries; admin/leadership and Project Management / Leadership members see every
department plus the all-up. Summaries are stored per day for historical reference. The dashboard
renders open ticket counts and titles in each department card.

## 4. Manual Send Templates console

`/admin/whatsapp-templates` (External nav, **admin/leadership only**, server-gated by
`requireAdminLeadership`). Pick an approved template, pick an audience, preview free/paid counts +
cost, send. No auto-scheduling — every send is a button press.

**Why the page is shaped this way:** Meta caps us at ~250 template messages/day, so the console
helps staff spend that quota deliberately. People who **messaged us in the last 24h** sit inside the
free customer-service window and can be answered without a template (don't count against the cap);
everyone else needs a template. So both the header segments and the per-audience preview split
recipients into *messaged ≤24h (free)* vs *needs a template (paid)*.

The window size defaults to **`WHATSAPP_WINDOW_HOURS`** (24) — `windowHours()` in `audience.ts` —
but the console exposes a **Window (hours)** input so staff can override it per action (any
positive value, resolved by `resolveWindowHours()`). The chosen value flows through as `window_hours` on
`POST /preview`, `/audience-export`, and `/send`, and as a `?hours=` query param on
`GET /api/admin/templates/segments` (which re-counts the header and echoes back `window_hours`);
`getInWindowPhones(hours)` applies it. Meta's billing window is 24h, so this is a conservative
safety margin: lower it (e.g. 14) to treat people who haven't messaged in that many hours as paid
even if technically still free, avoiding edge cases where the window closes between preview and
send. The console labels ("Conversed ≤Nh", the helper text) reflect the active value.

**Conversation-window filter.** Beyond just *showing* the split, a **Conversation window** dropdown
next to the Audience picker restricts any audience to one side of the 24h window: `all` (default),
`in_window` (free — conversed ≤24h), or `out_window` (paid — not conversed). It's a `window` param
(`WindowFilter` in `audience.ts`) threaded through `POST /preview`, `/audience-export`, and `/send`;
`previewExplicitRecipients(recipients, window)` post-filters by the per-recipient `inWindow` flag, so
the total/cost reflect exactly who will be messaged. Composes with every audience type (presets,
segments, custom, CSV). On the `custom` audience the `funnel` still describes the filter resolution
*before* the window filter.

**Reach segments** (header summary + sendable audiences). `segmentCounts()` (`audience.ts`) sizes
three segments, each split free/paid, exposed by `GET /api/admin/templates/segments` and shown as
cards atop the page; the same keys are selectable in the Audience dropdown. **All three are scoped to
people we expect to attend** — members of **registered (submitted) families** plus unregistered
callers who told us they're coming for Niyaz. Registration is our attendance signal (arrival date,
hotel, …), so the imported-but-never-registered roster is intentionally excluded (same principle as
the `/admin/niyaz` min/max tallies):
- `segment_all_users` — every attending member of a **registered** family
  (`registeredMemberRecipients()`) **∪** every distinct `unregistered_rsvps` phone, deduped.
- `segment_hof` — one head-of-family per **registered** family (`registered_hof`) **∪** every distinct
  `unregistered_rsvps` phone (each unregistered phone assumed to be one HOF), deduped. One reachable
  number per family, preferring the `is_head` member, else any member.
- `segment_hof_unresponded` — registered HOF whose family has **no RSVP response on record** (no
  `niyaz_rsvp` row sourced `whatsapp`/`admin` and no `niyaz_family_headcount`, via
  `respondedFamilyIds()`) **and** whom we **haven't already sent a template** (`templatedPhones()`).
  Unregistered phones are excluded — they're in `unregistered_rsvps` *because* they responded. This
  is the "fresh contacts" chase list: people we still need to reach for the first time, so it's the
  natural target when rationing the daily template cap.

`submittedFamilyIds()` is the shared registration gate (`registration_status='submitted'`).
`templatedPhones()` is the set of numbers we've already sent any approved template to — every send
routes through `sendTemplateNotification` → `recordOutboundMessage`, which logs an outbound
`messages` row with body prefixed `[template:…]`, so that prefix is the marker (covers registration
reminders, daily Niyaz RSVP, and notifications alike).

**Head-of-family identity.** The import marks `mumineen.is_head` where a member's own ITS equals the
family's `hof_its` (~933). Families whose head ITS isn't present as a member row had no head, so a
one-time backfill (`20260611111345_backfill_family_heads`) designates a primary person per such
family (preferring a member with a number, then an adult, then earliest), giving every family exactly
one head — so a registered family is never missed for lack of a head flag.

**Scale note.** PostgREST caps a response at 1000 rows, which had silently truncated the roster
scans (3k+ members read as ~900). `audience.ts` now pages through those reads (`fetchAllRows`), and
the per-family audiences filter a single paginated member scan in-app instead of a giant
`family_id IN (...)` query that failed at scale — so the counts are now complete.

**Template hygiene.** A **Manage templates** popup lets admins give each Meta template a
`friendly_name` and an `is_active` flag (`whatsapp_template_settings`, via
`PUT /api/admin/templates/settings`). `GET /api/admin/templates` returns the full catalog with these
merged in; the console shows the friendly name and **hides inactive templates from both the Broadcast
and Single-recipient dropdowns** (the popup still lists them so they can be reactivated). The
`/admin/niyaz` composer and cron/notification flows are unaffected.

- Audiences (`src/lib/whatsapp/audience.ts`), always **deduped by phone**: `selected_users`,
  `chicago_committee`, `arrived_hof`, `registered_hof`, `all_members`, the three `segment_*` keys
  above, `custom` (rule-tree filter), and `csv_upload`. Split into in-window (free) vs out-window
  (paid) using `conversation_sessions.last_message_at`; cost via `WHATSAPP_UTILITY_MSG_COST_USD`.
  The `custom` filter fields (`FIELD_CATALOG` in `audience-filter.ts`) include person/family columns
  such as Jamaat, City, Gender, Age, Is-head-of-family, ITS, and **HOF ITS** (`hof_its` — target a
  whole family by its head's ITS, e.g. `HOF ITS = 12345678`), plus three **behavioral** groups
  attached per-phone in `loadRoster()` from aggregate views (keyed by `whatsapp_e164`):
  - **Engagement** (from `phone_message_stats`): `hours_since_last_inbound` (≤ N — conversed recently),
    `has_messaged_us` (= No — cold contacts), `no_reply_from_them` (we sent ≥1, zero inbound), and
    `inbound_message_count` (≥ N). A never-messaged row uses a large `hours_since` sentinel so both
    `≤ N` (excludes) and `> N` (includes) read correctly.
  - **AI tool usage** (from `phone_tool_usage` over `tool_audit_logs`) and **Template history** (from
    `phone_template_sends`, parsing the `[template:NAME]` outbound marker) are `set` fields: a recency
    -windowed multiselect with the value `{ items, withinHours }`. `in` = did any of the selected
    within the last N hours; `notIn` = did none within N hours (covers never-done **and**
    done-before-the-window). Blank hours = ever/never. Tool options are the curated mumineen-facing
    tools (`FILTERABLE_AGENT_TOOLS` in `src/lib/agent/tool-names.ts`); template options are codes that
    have actually been sent. Rendered by the custom `RecentSetValueEditor` (multiselect + "within last
    N hours") wired into the QueryBuilder via `controlElements.valueEditor`.
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
  key as a guard). `audience-export` accepts `csv_upload` too: it returns the **resolved** audience
  (deduped, roster-enriched, free/paid-labelled) — the rows that will actually be messaged, not the raw
  uploaded file — using the same parse + `enrichFieldsByPhone` + `previewExplicitRecipients` pipeline.
- Engine (`src/lib/whatsapp/broadcast.ts`): a broadcast enqueues recipients; the send route then drains
  **inline until the queue is empty** (`drainUntilEmpty`, a bounded loop) so small/medium sends complete
  in-request. `/api/cron/broadcast-drain` (every minute) is a backstop for large sends, and
  `POST /api/admin/templates/drain` ("Send pending" in the console) lets an admin push pending recipients
  manually — so a broadcast never silently hangs in `running` when the cron isn't firing. Throttled
  batches go through the shared `sendTemplateNotification` pipeline; logged in `template_broadcasts` /
  `template_broadcast_recipients`. A broadcast is finalized to `completed` only once it has at least one
  recipient row and none are still `queued`/`sending` — a broadcast with zero recipient rows is treated
  as not-yet-populated (the row is inserted a moment before its recipients), so a concurrent drain can't
  finalize it empty and strand its recipients as `queued`.
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
- Undeliverable-number suppression: when a `failed` callback carries Meta code `131026` (not on
  WhatsApp / can't receive), the webhook records it in `whatsapp_undeliverable` via the
  `record_whatsapp_undeliverable` RPC (`src/lib/whatsapp/undeliverable.ts`). After
  `UNDELIVERABLE_FAIL_THRESHOLD` (2) such failures a number is marked `suppressed`, and the audience
  layer (`suppressedPhones` in `previewExplicitRecipients` + the explicit-recipients path of
  `createBroadcast`) drops it from **every** future broadcast — so a dead number isn't re-sent or
  re-billed. Two failures (not one) is deliberate: a single 131026 can be transient, and we'd rather
  send one wasted message than silently drop a real family. Admins manage the list from the Broadcast
  log header (**Undeliverable numbers** modal): `GET /api/admin/whatsapp/undeliverable` lists
  suppressed numbers with identity; `DELETE …?phone=` un-flags one (clears suppression, resets the
  counter) for a mistyped/corrected number. Both admin/leadership only.
- Audience transparency: the expanded Broadcast-log row also shows an **Audience & filters** block —
  the audience label, the conversation-window toggle + hours, the saved rule tree rendered in plain
  language (`formatQuery` natural-language; `set`-field compound values render approximately), and the
  variable bindings. The toggles are persisted on `template_broadcasts` (`window_filter`,
  `window_hours`, `selected_user_ids`; `audience_rules`/`variable_bindings` were already stored) by
  `createBroadcast()`; older broadcasts predating the columns read as "not recorded". The **full
  recipient list** (every status, not just failures) is available — loaded on demand (PII) and as a
  CSV — from `GET .../broadcasts/[id]/recipients` (admin/leadership only), reusing the failures route's
  roster resolution.
- API: `GET /api/admin/templates` (catalog + friendly-name/active annotations),
  `PUT /api/admin/templates/settings` (friendly name / active flag),
  `GET /api/admin/templates/segments` (reach-segment sizes),
  `POST /api/admin/templates/preview`, `POST .../send`,
  `POST .../drain`, `GET .../broadcasts(/[id])`, `GET .../broadcasts/[id]/failures`,
  `GET .../broadcasts/[id]/recipients` (full audience, JSON/CSV),
  `GET /api/admin/whatsapp/undeliverable`, `DELETE /api/admin/whatsapp/undeliverable?phone=`.

The console handles **no-variable** templates to audiences; the older single-recipient composer
(`/admin/whatsapp`, free-text + variable templates) remains for those cases. Full consolidation is
a follow-up.

## Permissions / privacy

All new API routes are authorized: agent routes by `x-whatsapp-from` (self-scoped), admin routes by
`requireAdminKey`, and the send console by `requireAdminLeadership` (admin key **and** DB-verified
admin/leadership). RLS is enabled on every new table. Phone numbers live only in the DB and are
never returned by preview/log endpoints or logged.
