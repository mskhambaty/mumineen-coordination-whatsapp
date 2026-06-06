# Escalation/Support

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
escalation_status = 'resolved' ──►  returns to the Conversations tab
```

Re-escalation is allowed (sets `pending` again). The AI keeps replying throughout.

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
| `other` | anything else |

`escalation_priority`: `urgent` (emergency or strong frustration) or `normal`.

## Tools (all new ones are API-first)

**Consolidate** the 5 public site tools — `get_event_schedule`, `get_parking_info`,
`get_directions`, `get_faq_answer`, `get_lost_found_info` — into a single
**`get_site_content_faq`** (they all read the same vectorized site content).

**Add two API-first tools** (call internal API routes like the task tools do, via
`callInternalApi`):

- **`move_to_escalation`** — last resort. Params: `reason`, `priority`, `category`.
  POSTs to an escalation route that tags the conversation, sets `escalation_status='pending'`,
  notifies on-call support, and returns the guest acknowledgment.
- **`create_issue`** — creates an **external** issue in the tasks system (see Issues below).
  A guest can ask the AI to log an issue for anything they observe during the event.

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

- **New WhatsApp dropdown: "Escalation/Support"** — management screen with a **user
  table** + **Add** button. Add picks from the **existing user list**; adding a user inserts
  an `escalation_support_members` row (= assigns the role) and lets them set **on-call hours**
  (weekday × time ranges).
- **Lead Inbox split into two tabs:** **Conversations** (normal) and **Escalations**
  (`pending` threads, simplified/grouped view with tag + priority).
- **De-escalate button** on an escalated chat → sets `escalation_status='resolved'` and
  returns the thread to Conversations.

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

## Build-time / config items
- Confirm the issues table schema and Kanban external/internal rendering.
- Postmark: escalation template ID + Supabase var (owner to provide); author HTML template.
- WhatsApp: staff-alert template `escalation_ticket_assigned` approved and wired up
  (set `WHATSAPP_BUSINESS_ACCOUNT_ID`). ✅
- Env: deep-link base URL (`NEXT_PUBLIC_APP_URL`) for notification links.
