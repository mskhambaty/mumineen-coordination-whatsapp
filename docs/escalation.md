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

### Canonical status vs. work stage

`escalation_status` (`none` / `pending` / `resolved`) is the **authoritative** open-vs-resolved
lifecycle and drives tab membership. `escalation_stage` (`pending` / `picked_up` /
`waiting_on_department` / `resolved`) is the fine-grained **work sub-state while pending** — never
the authority on resolved-ness. All resolved-ness checks (tab membership, the issue panel's SLA
"breaching" flag) read `escalation_status`. Resolve writes set both columns; the
`20260616010000_reconcile_escalation_stage_status` migration realigns any legacy rows where they
diverged.

### Resolved escalations in the inbox

Resolved escalations remain in the **Escalations tab** (escalation history), not the Conversations
tab — the Conversations tab shows only `escalation_status = 'none'` threads. They are hidden by the
default "Active" stage filter and revealed via the **Resolved** / **All** stage options (paged with
"Load more"). Resolved escalations linked to an issue are always loadable so an issue's "View →"
link always reaches them.

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

- **`move_to_escalation`** — unified escalation + issue creation. Params: `reason`, `title`,
  `description`, `priority`, `category`, `department`. In one call it:
  1. Tags the conversation as pending escalation and notifies on-call support.
  2. Creates an issue in the `issues` table (appears in the Inbox Issues tab).
  3. Links the escalation conversation to the issue via `issue_escalation_links`.
  4. Creates a workspace task (`item_type='issue'`) in the `tasks` table.
  5. Notifies department issue contacts (email + WhatsApp `department_ticket_assigned` template).
  6. Notifies escalation team (email + WhatsApp escalation template).

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

## Issue Deduplication

When `POST /api/escalations` creates an escalation, it checks for matching open issues
**before** creating a new one. The flow:

1. Fetch the user's last 8 inbound messages (24h window) for context.
2. Call `matchIssuesToEscalation()` (AI matching with keyword fallback) against all
   open/in-progress issues.
3. **Match found** → link the escalation to the existing issue via `issue_escalation_links`
   and `linked_issue_id`. No new issue or workspace task is created. The activity log
   records `linked_to_issue` with `deduplicated: true` and the matched issue number.
4. **No match** → create a new issue + workspace task + link + notify (original flow).

The response includes `deduplicated: true/false` so callers know which path was taken.

The matching logic lives in `src/lib/escalation/issue-match.ts` and is shared with the
portal AI Suggestions endpoint.

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
