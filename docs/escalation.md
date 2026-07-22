# Escalation & On-call

> **Status: design spec — not yet implemented.** This captures the agreed design for
> escalating WhatsApp conversations to a human support team. Build in phases (see end).

## Principle

Escalation is the **last resort**. The AI must genuinely try to answer first (site/FAQ
content). `move_to_escalation` is deliberately hard to trigger — for both the user and the
AI — and is gated by deterministic rules, not loose judgment.

The AI **stays on** after a conversation is escalated. Escalation is a *flag + notify*
signal layered on top of the agent; it does **not** pause the bot and is independent of
`handling_mode` (manual takeover remains a separate, explicit admin action).

## Lifecycle

```
normal conversation
      │  (move_to_escalation: AI exhausted / emergency / validated human request)
      ▼
escalation_status = 'pending'  ──►  moves to the Escalations tab
      │                              on-call support notified (email + WhatsApp + deep link)
      │                              guest told "this has been escalated"
      │  (support member clicks "De-escalate" on the chat)
      ▼
escalation_status = 'resolved' ──►  stays in the Escalations tab as history
                                     (hidden behind the "Resolved"/"All" stage filter)
```

Re-escalation is allowed (sets `pending` again). The AI keeps replying throughout.

### Status is derived from stage (single source of truth)

`escalation_stage` (`none` / `pending` / `picked_up` / `waiting_on_department` / `resolved`) is the
**single source of truth**. `escalation_status` (`none` / `pending` / `resolved`) is a coarse
projection of it and drives tab membership / the hot conversations query (it stays a real, indexed
column for that). The two used to be hand-maintained separately and **diverged** (a real prod bug);
now a DB trigger derives `escalation_status` from `escalation_stage` on every insert/update
(`escalation_status_from_stage()` + `set_escalation_status_from_stage`, migration
`20260617043459_escalation_status_derived_from_stage`), so they can never diverge again:

| `escalation_stage` | derived `escalation_status` |
|---|---|
| `resolved` | `resolved` |
| `none` / null | `none` |
| `pending` / `picked_up` / `waiting_on_department` | `pending` |

**Write only `escalation_stage`** — never set `escalation_status` in app code (the trigger overrides
it). Reads of `escalation_status` are fine and encouraged for the open/resolved/none lifecycle.

### Resolved escalations in the inbox

Resolved escalations remain in the **Escalations tab** (escalation history), not the Conversations
tab — the Conversations tab shows only `escalation_status = 'none'` threads. They are hidden by the
default "Active" stage filter and revealed via the **Resolved** / **All** stage options (paged with
"Load more"). Resolved escalations linked to an issue are always loadable so an issue's "View →"
link always reaches them.

### Escalations are cross-scope

The inbox `scope` split (`main` vs `niyaz`, by `conversation_sessions.phone_number_id`) applies to
the **Conversations** list only. **Escalations are cross-cutting**: under the default `main` scope
the Escalations tab loads pending + resolved escalations regardless of the number they arrived on,
including the broadcast/niyaz number. Mumineen often reply to broadcast blasts and the AI escalates
those threads — a breaching ticket must never be hidden just because it landed on the broadcast
line. `scope=niyaz` still narrows escalations to the niyaz number for that focused view.

## Triggers & decision logic

Escalate **only** when one of these holds:

1. **AI exhausted** — it attempted an answer (did a site/FAQ lookup) and still cannot
   satisfy the user.
2. **Validated human request** — the user asks for a person *and* the conversation context
   supports it. A bare "hi" → "talk to someone" does **not** qualify: the AI must first ask
   what they need, attempt to help, and escalate only if it still cannot.
3. **Emergency** — lost child, lost passport, medical, security → **immediate** escalation,
   `priority = urgent`, and the guest is told it has been escalated.
4. **Deterministic frustration / urgency** — sustained dissatisfaction detected across history.

### Code-level guardrails (prevent over-escalation)
- Block `move_to_escalation` when the thread has **< 2 user turns and no emergency keyword**
  (kills premature "talk to a human").
- Emergency keyword match → allow immediate escalation.
- The system prompt frames the tool as a genuine last resort.
- On escalation, always send the guest an acknowledgment.

## Tag taxonomy & priority

`escalation_category` (single tag, AI-chosen):

| Tag | Examples |
|-----|----------|
| `emergency` | lost child, lost passport, medical, security |
| `accommodation` | hotel, room, check-in |
| `transport` | utaro / pickup, parking, directions |
| `registration` | ITS, araz, passes |
| `schedule` | waaz timings, venue, program |
| `facilities` | thaali/food, washrooms, accessibility |
| `complaint` | dissatisfaction, conduct |
| `religious_followup` | Waaz/deen or personal ruling follow-up |
| `lost_found` | Lost-item report; automatically routed to Lost and Found |
| `other` | anything else |

`escalation_priority`: `urgent` (emergency or strong frustration) or `normal`.

## Tools (all new ones are API-first)

**Consolidate** the 5 public site tools — `get_event_schedule`, `get_parking_info`,
`get_directions`, `get_faq_answer`, `get_lost_found_info` — into a single
**`get_site_content_faq`** (they all read the same vectorized site content).

**Add two API-first tools** (call internal API routes like the task tools do, via
`callInternalApi`):

- **`move_to_escalation`** — hand-off to the human team. Params: `reason`, `title`,
  `description`, `priority`, `category`, `department`, `requires_department_coordination`. In one call it:
  1. Tags the conversation as pending escalation and notifies on-call support.
  2. Notifies escalation team (email + WhatsApp escalation template).
  3. **Only when `requires_department_coordination` is true** (an actionable problem a department must
     coordinate to fix — not an individual request/question/hand-off) does it also create a tracked
     issue: insert into `issues`, link the conversation via `issue_escalation_links`, create a
     workspace task (`item_type='issue'`), and notify department issue contacts
     (`department_ticket_assigned`). **Escalation ≠ issue** — a single person's request being
     escalated does not create an issue. Issue creation is idempotent per conversation (a
     re-escalation reuses the conversation's existing open issue — see ISS-21/ISS-22).

## Data model

### `conversation_sessions` (new columns)
| Column | Notes |
|--------|-------|
| `escalation_status` | `none` / `pending` / `resolved` (default `none`) |
| `escalation_reason` | short text |
| `escalation_priority` | `normal` / `urgent` |
| `escalation_category` | one of the tags above |
| `escalated_at` | timestamptz |
| `escalation_source` | `ai` / `rule` / `manual` |

`pending` = shown in the Escalations tab. Index on `escalation_status`.

### `escalation_support_members` (new table — membership *is* the role)
| Column | Notes |
|--------|-------|
| `id` | uuid PK |
| `user_id` | FK → `whatsapp_users.id` (unique) |
| `created_at` | timestamptz |

### `escalation_oncall_hours` (new table — weekly recurring, America/Chicago)
| Column | Notes |
|--------|-------|
| `id` | uuid PK |
| `member_id` | FK → `escalation_support_members.id` |
| `day_of_week` | 0–6 (Sun–Sat) |
| `start_time` | time (local, America/Chicago) |
| `end_time` | time |

Multiple rows per member (multiple ranges per day). No one-off overrides. All times are
evaluated in `America/Chicago`.

### Issues (existing tasks system — already built)
Confirmed in `20260530200100_milestones_and_item_types.sql`:
- **Issues are `tasks` rows with `item_type = 'issue'`** (`tasks.item_type` is `task`/`issue`).
- **Milestones** are a separate `milestones` table; tasks link via `tasks.milestone_id`.
- `conversation_events` already supports `issue_created` / `issue_updated` / `issue_resolved`.

What's **missing**: no explicit external/internal flag. `tasks.source`
(`transcript`/`whatsapp_agent`/`manual`) only loosely implies origin. **Add an `origin`
column** (`external` | `internal`) to `tasks` and render the distinction on the Kanban.
`create_issue` writes an `item_type='issue'`, `origin='external'` task linked to the
conversation (`source='whatsapp_agent'`).

## Roles & access

There is no single "role" field — users carry independent dimensions:
`whatsapp_users.role` (`visitor`/`committee`/`admin`), `whatsapp_users.global_role`
(`member`/`pm`/`hod`/`leadership_admin`), and per-department `dept_role`.

**Escalation/support is a membership, not an enum value** — being a row in
`escalation_support_members` *is* the role (mirrors `department_members`). This avoids
clobbering a user's existing `global_role` and naturally carries the on-call hours.

### Inbox access matrix
| Who | Inbox access |
|-----|--------------|
| `admin` | ✅ (today) |
| `global_role = leadership_admin` | ✅ (today) |
| `escalation_support_members` row | ✅ (new — same email/password login, **whole inbox**) |
| `committee` | ❌ (unchanged — no portal login) |
| everyone else | ❌ |

Implementation: widen the login gate and `isAdminOrLeadership` / inbox route guards to also
allow `escalation_support_members`. The membership is shown under the user's **Memberships**
section on their profile (same page as department memberships), with on-call hours editing.

## Admin UI

- **Admin nav entry (under Settings): "Escalation & On-call"** — management screen with a **user
  table** + **Add** button. Add picks from the **existing user list**; adding a user inserts
  an `escalation_support_members` row (= assigns the role) and lets them set **on-call hours**
  (weekday × time ranges).
- **Lead Inbox split into two tabs:** **Conversations** (`escalation_status = 'none'` threads)
  and **Escalations** (`pending` + `resolved` threads; resolved hidden behind the stage filter).
- **De-escalate button** on an escalated chat → sets `escalation_status='resolved'`; the thread
  stays in the Escalations tab as resolved history (visible via the Resolved/All stage filter).

## Notifications (on-call support only)

When `move_to_escalation` fires, notify **only** `escalation_support_members` who are
**currently on-call** (per `escalation_oncall_hours`, evaluated in America/Chicago). Not
leadership, not committee, no one else.

- **Email** — Postmark template (always deliverable; this is the guaranteed channel).
  - Template ID/alias: `escalation-request`
  - Env var: `POSTMARK_ESCALATION_REQUEST_TEMPLATE`
  - An HTML template will be authored to paste into Postmark.
- **WhatsApp** — the 24h session window is **per recipient**. Guest A's window does **not**
  authorize messaging a staff member; the staff number has no open window, so a cold alert
  **requires a pre-approved Meta template message** (free-form returns error 131047). Sent
  best-effort on top of the guaranteed email via the approved utility template
  `escalation_ticket_assigned`. Body variables: `{{1}}` request summary
  (`"<Category>"`, prefixed `"URGENT — "` for urgent escalations), `{{2}}` the escalation
  reason/details, `{{3}}` the portal deep link. Only on-call members who have a phone number
  are messaged. All template sends route through `src/lib/whatsapp/send-template.ts` so logging
  is uniform with the welcome and issue-contact notifications.
- **Deep link** in both → opens the app → prompts login if needed → lands directly on that
  conversation in the Escalations tab (redirect-after-login preserves the target).

All notification sends are fire-and-forget (failures never block the agent reply).

## Phasing

1. **Core** — schema (escalation fields + support/on-call tables), tool consolidation,
   `move_to_escalation` + guardrails + guest acknowledgment, Escalations tab + de-escalate.
   ✅ **Done** (`20260531130000_escalation_and_support.sql`; `get_site_content_faq`;
   `POST /api/escalations` + `PUT /api/admin/conversations/[phoneE164]/escalation`;
   Escalations tab + De-escalate button).
2. **Support management** — role membership UI under Memberships, on-call hours editor,
   inbox-access widening.
   ✅ **Done** — `/admin/escalation` page (add members from existing users, remove, weekly
   on-call hours editor) under the WhatsApp nav dropdown; `GET/POST /api/admin/escalation-support`
   and `DELETE/PUT /api/admin/escalation-support/[id]`; login + inbox access widened to support
   members (`is_support` flag, `canAccessInbox`). On-call hours are edited on the Support page;
   showing the membership on the user's profile page is a small follow-up.
3. **Notifications** — on-call evaluation, Postmark email (`escalation-request` template) +
   HTML template, deep link + redirect-after-login. **Email ships first (guaranteed channel).**
   ✅ **Done (email + WhatsApp)** — `/api/escalations` notifies every currently on-call support
   member (evaluated in America/Chicago via `src/lib/escalation/notify.ts`) over both channels:
   the `escalation-request` Postmark email (`POSTMARK_ESCALATION_REQUEST_TEMPLATE`; HTML in
   `docs/postmark-escalation-template.html`) and the approved Meta utility template
   `escalation_ticket_assigned` (best-effort, on-call members with a phone only). Both deep-link
   to `/admin/conversations?phone=...&tab=escalations`; unauthenticated users are sent to login
   with a `?redirect=` and returned to the thread after signing in. WhatsApp sends go through the
   shared `src/lib/whatsapp/send-template.ts` pipeline (requires `WHATSAPP_BUSINESS_ACCOUNT_ID`).
4. **Issues** — `create_issue` tool + external/internal distinction on the Kanban board.
   ✅ **Done** — `create_issue` tool (audience external) → `POST /api/issues` creates an
   `item_type='issue'`, `origin='external'`, department-less task linked to the reporting
   guest. `tasks.department_id` is now nullable (`20260531140000_tasks_department_nullable.sql`).
   The Kanban shows an **Issue** badge plus an **External**/**Internal** origin badge.
   Department issue contacts are managed per `department_members` row with
   `contact_for_issues`; matching members receive `assignment-notification` email and the
   Meta utility template `department_ticket_assigned` when an issue is created for, or moved
   to, their department.

   **Managing department contacts (Escalation & On-call page).** The "Department Contacts"
   section lists two kinds of contact, merged: `reference` rows (freestanding
   `department_contacts` — external people with no portal account) and `member` rows (portal
   users flagged `contact_for_issues`, shown with a **User** badge). "+ Add contact" supports:
   - **Existing user** — pick a **member of the selected department** (the picker is scoped to
     that department's members) → sets `contact_for_issues=true` on their existing
     `department_members` row. It does **not** add the user to the department or change their
     role — that's managed on the Departments page (400 if the user isn't already a member).
   - **New contact** — free-text name/role/phone/email/notes → a `reference` row by default.
     Tick **"Also add as a department user"** to instead create a portal user (role `committee`
     / global `member`, reusing any existing user with the same phone) and a `contact_for_issues`
     membership.

   All three go through `POST /api/admin/department-contacts` (`mode` = `reference` |
   `existing_user` | `new_user`); `GET` returns the merged list. Removing a `member` contact
   clears `contact_for_issues` (the user/membership is kept); removing a `reference` deletes the
   row.

## Escalation ≠ issue, and grouping is suggestion-only (no topical auto-link)

`POST /api/escalations` creates a tracked issue **only when `requires_department_coordination` is
true** — an actionable problem a department must coordinate to fix. A plain escalation of one
person's request/question/hand-off creates **no** issue (the on-call team follows up with that
person). When it does create an issue it links only that conversation, and is idempotent per
conversation (a re-escalation reuses the conversation's open issue rather than duplicating — the
ISS-21/ISS-22 bug). It still does **not** topically auto-link to OTHER conversations' issues.

**Trigger B — cross-conversation promotion (auto, cron).** When MULTIPLE distinct conversations
report the SAME problem, that pattern is a real issue. `/api/cron/escalation-grouping` (hourly, see
`vercel.json`) scans ungrouped active escalations (`escalation_status='pending'`, no linked issue,
last 72h), asks the model to cluster genuinely same-problem ones, and promotes each cluster into one
shared issue + task linking all its conversations (`src/lib/escalation/issue-grouping.ts`). It is
deliberately conservative — the pure `selectPromotableClusters` gate requires **high** confidence and
**≥2 distinct** conversations, dedupes ids, and assigns each conversation to at most one cluster — so
the model can't over-group or promote a lone escalation. Created issues are visible/reversible in the
Issues tab. (Auto-creating issues is consequential — watch the first runs; thresholds live in
`issue-grouping.ts`.) Single-source, manual grouping still uses the suggestions endpoint below.

An earlier auto-dedupe linked each new escalation to the best AI/keyword match.
That over-grouped on topical adjacency — e.g. parking-pass requests (and even a registration
request) were auto-linked onto a carpool issue because they shared the `transport` department and
words like "car / parking / masjid". Auto-linking the model into a consequential action also runs
against the agent guardrails in `AGENTS.md`.

Grouping is now **human-confirmed**:

- When a triager opens an escalation, `GET /api/admin/escalations/[phone]/suggestions` surfaces
  matching open issues via `matchIssuesToEscalation()` (`src/lib/escalation/issue-match.ts`).
- Each match carries a `confidence` (`high` | `medium` | `low`). Only matches at or above
  `SUGGESTION_CONFIDENCE_THRESHOLD` (default **`high`**) are surfaced — the matcher over-matches on
  topical adjacency, so weaker matches would just be noise. Keyword-fallback matches are capped at
  `medium` (never auto-surface under the `high` threshold).
- The triager applies the link deliberately (or uses the AI Grouping modal for batch grouping).

`POST /api/escalations` still returns `deduplicated: false` for backward compatibility.

## Per-link episode lifecycle + issue auto-close

A `conversation_session` is one row per person and its `escalation_*` fields track only the
**current** episode. So a person can offer a carpool (escalates → issue A), get resolved, then later
ask about something else (escalates → issue B) on the *same* conversation. To support this, each
**link** carries its own lifecycle on `issue_escalation_links`:

- `status` (`open` | `resolved`), `resolved_at`, `resolved_by`.

Rules:

- **Resolved-ness is per link, not per conversation.** The issue detail panel marks a linked
  escalation resolved (and computes SLA "breaching") from the **link's** `status` — so issue A shows
  that person resolved even after they re-escalate into issue B.
- **Resolving a conversation** (inbox de-escalate or the escalation "Resolve" action) marks that
  conversation's currently-**open** link(s) `resolved`. In practice a conversation has at most one
  open link (past episodes are already resolved).
- **Resolving an issue** (bulk-resolve) marks all its links `resolved`.
- **Auto-close:** when an issue's links are *all* resolved, the issue is set to `resolved`
  automatically. **Auto-reopen:** adding a fresh (open) link to a resolved issue sets it back to
  `open`. Manual `open`/`in_progress` and link-less issues are never touched.

The status-sync logic lives in `src/lib/issues/link-status.ts`
(`resolveOpenLinksForSession`, `resolveAllLinksForIssue`, `syncIssueStatusFromLinks`) and is called
from the resolve and link/unlink routes (non-critically — a sync failure never fails the action).

## AI Suggestions

When a support member views an escalation in the admin portal, an **AI Suggestions** panel
appears in the right sidebar (below Conversation Quality). It provides two types of
suggestions, generated on-demand:

1. **Matching Issues** — the escalation reason and category are compared against all open
   issues using an AI call. The top 1–3 relevant matches are shown with a one-click **Link**
   button (reuses the existing issue-linking infrastructure).
2. **Resolution History** — past resolved escalations with the same category are queried
   from `escalation_activity_log` (action = `resolved`, non-null `resolution_note`). An AI
   summary of common resolution patterns is displayed.

### API

`GET /api/admin/escalations/{phoneE164}/suggestions` — requires `canAccessInbox`.
Returns `{ matching_issues, resolution_history }`. Results are cached in-memory for 3 minutes.

### Key files

| File | Purpose |
|------|---------|
| `src/lib/escalation/issue-match.ts` | AI + keyword issue matching (shared) |
| `src/app/api/admin/escalations/[phoneE164]/suggestions/route.ts` | Suggestions endpoint |
| `src/lib/escalation/suggestions-cache.ts` | In-memory TTL cache |
| `src/app/admin/conversations/page.tsx` | UI panel (AI Suggestions section in aside) |

## Build-time / config items
- Confirm the issues table schema and Kanban external/internal rendering.
- Postmark: escalation template ID + Supabase var (owner to provide); author HTML template.
- WhatsApp: staff-alert template `escalation_ticket_assigned` approved and wired up
  (set `WHATSAPP_BUSINESS_ACCOUNT_ID`). ✅
- Env: deep-link base URL (`NEXT_PUBLIC_APP_URL`) for notification links.
