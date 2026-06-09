# Meal RSVP · Feedback · Daily Department Digest · Send Console

One system across three concerns for the days of Ashara: capturing jaman (meal) RSVPs and
experience feedback over WhatsApp, rolling them up into a nightly per-department briefing, and a
manual console for broadcasting approved templates.

## 1. Niyaz RSVP (jaman) — per-mumin

RSVP is tracked **per mumin per event** in `niyaz_rsvp`, collected day-by-day via WhatsApp button
templates (§1a). (It was initially defaulted from arrival dates; that's been retired — see the
default-rule note below.)

- **Events** live in `rsvp_registration_instance` (`meal` `lunch`|`dinner`, `event_date`,
  `serving_type` `thaal`|`packet`, unique `(event_date, meal)`). Ashara 1448H = **20 events**: a
  **Pehli Raat thaal (Jun 14)**, Jun 15–23 lunch (thaal) + dinner (packet), and a **dinner thaal
  (Jun 24)**. (`supabase/migrations/20260606100500_seed_*`, corrected in `20260608130000_niyaz_event_corrections`.)
- **`niyaz_rsvp`** (`20260608131000_*`): one row per `(registration_instance_id, mumin_id)` with
  `attending boolean`, `family_id`, and `source` (`default`|`registration`|`whatsapp`|`admin`). RLS
  on, service-role access only. `rsvp_responses` is retired (left empty) for the meal flow.
- **Arrival-date defaulting (retired).** Originally the table was seeded from arrival dates
  (backfill `20260608132000_*` + the `seed_family_niyaz_rsvp(family)` function, called on
  registration). This is **no longer used** — the data was reset and the registration call removed —
  so the counts reflect only real button/agent responses. The function + backfill migration remain as
  history but nothing invokes them.
- **Adult/kid/family + thaal counts** come from the **`niyaz_event_tallies`** view
  (`20260608133000_*`): per event, yes/no split by `mumineen.is_adult` (null = adult) and by family,
  plus `thaal_count = ceil(attending heads / 8)`.

Code: `src/lib/rsvp/family.ts` (phone → roster family), `src/lib/rsvp/meal-rsvp.ts`
(`getFamilyNiyazGrid`, `setFamilyNiyazRsvp` whole-family cascade, `getEventTallies`,
`getMealAttendanceTotals`). API: `GET/POST /api/rsvp/meals` (self-scoped via `x-whatsapp-from`,
Zod-validated; POST entries are `{attending, dates?, meal?, all?}` — a change cascades to the whole
family). Agent tools: `get_family_meal_rsvps`, `set_family_meal_rsvps` (public; the agent mainly
records *changes* — guidance in `MEAL_RSVP_FEEDBACK_RULE`). Admin: `/admin/niyaz` shows the events
sorted by date with the eight count columns + thaal count, backed by
`GET /api/admin/niyaz/instances` (reads the tallies view).

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
`source='whatsapp'`), sends a **confirmation**, and skips the agent. The per-event detail panel lists
the recorded responses (`GET /api/admin/niyaz/instances/[id]/responses`, reads `niyaz_rsvp`).
Outbound quick-reply payloads are emitted by `buildSendComponents` (`src/lib/whatsapp/templates.ts`).

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
  `chicago_committee`, `arrived_hof`, `registered_hof`, `all_members`. Split into in-window (free)
  vs out-window (paid) using `conversation_sessions.last_message_at`; cost via
  `WHATSAPP_UTILITY_MSG_COST_USD`.
- Engine (`src/lib/whatsapp/broadcast.ts`): a broadcast enqueues recipients; `/api/cron/broadcast-drain`
  (every minute) sends throttled batches through the shared `sendTemplateNotification` pipeline, so
  a multi-thousand send clears within ~an hour. Logged in `template_broadcasts` /
  `template_broadcast_recipients`.
- Delivery status: the WhatsApp webhook applies Meta `delivered`/`read`/`failed` callbacks by
  `wa_message_id` and marks `replied` when a target messages back (`src/lib/whatsapp/broadcast-status.ts`).
- API: `GET /api/admin/templates`, `POST /api/admin/templates/preview`, `POST .../send`,
  `GET .../broadcasts(/[id])`.

The console handles **no-variable** templates to audiences; the older single-recipient composer
(`/admin/whatsapp`, free-text + variable templates) remains for those cases. Full consolidation is
a follow-up.

## Permissions / privacy

All new API routes are authorized: agent routes by `x-whatsapp-from` (self-scoped), admin routes by
`requireAdminKey`, and the send console by `requireAdminLeadership` (admin key **and** DB-verified
admin/leadership). RLS is enabled on every new table. Phone numbers live only in the DB and are
never returned by preview/log endpoints or logged.
