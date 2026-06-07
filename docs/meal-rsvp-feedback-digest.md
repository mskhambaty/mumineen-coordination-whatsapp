# Meal RSVP · Feedback · Daily Department Digest · Send Console

One system across three concerns for the days of Ashara: capturing jaman (meal) RSVPs and
experience feedback over WhatsApp, rolling them up into a nightly per-department briefing, and a
manual console for broadcasting approved templates.

## 1. Meal RSVP (jaman)

The existing RSVP tables are reused as a **meal-slot grid** — no new tables:

- `rsvp_registration_instance` gains `meal` (`lunch`|`dinner`), `event_date`, `serving_type`
  (`thaal`|`packet`) and a unique `(event_date, meal)` index. Each row is one meal slot. Seeded for
  Ashara 1448H: **Sun Jun 14 dinner only (Pheli Raat), Mon Jun 15 → Wed Jun 24 (Ashura) lunch +
  dinner**, America/Chicago. (`supabase/migrations/20260606100000_*`, `..._100500_seed_*`.)
- `rsvp_responses` is reused unchanged — one updatable row per submitter per slot, latest-wins,
  `head_count` = number attending that meal.

Code: `src/lib/rsvp/family.ts` (phone → roster family), `src/lib/rsvp/meal-rsvp.ts` (grid read,
record, `applyMealRsvps` with date-range expansion). API: `GET/POST /api/rsvp/meals`
(self-scoped via `x-whatsapp-from`, Zod-validated). Agent tools: `get_family_meal_rsvps`,
`set_family_meal_rsvps` (public; guidance in `MEAL_RSVP_FEEDBACK_RULE`).

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

## 3. Nightly department digest (22:00 UTC)

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

Cron: `/api/cron/department-digest` (22:00 UTC, `?date=` override). Portal: `/admin/department-digest`
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
