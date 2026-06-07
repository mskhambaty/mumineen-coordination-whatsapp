# Admin Dashboard

## Overview

The admin dashboard provides a web interface for managing tasks, departments, users, and transcript uploads. It's built with React (Next.js App Router) and Tailwind CSS.

## Pages

### Login (`/admin/login`)
- Production portal: `https://www.chicagorelaycenter.com/admin/login`
- Email and password authentication
- Forgot password link that calls `POST /api/auth/forgot-password`; reset emails use Postmark template alias `password-reset`
- Password setup/reset links open `/admin/reset-password`; after a successful password save, the page stores the returned user object and routes into `/admin` (the session itself is set as an httpOnly cookie by the server)
- Legacy fallback password is read from `ADMIN_FALLBACK_PASSWORD` only and must not be committed to the repo
- Users with admin/leadership, escalation support, department PM/HOD, or IT access can log in
- Primary admin: mskhambaty@gmail.com (Mufaddal Khambaty)

### Dashboard Home (`/admin`)
- Count cards: Total Departments, Total Tasks, Open Tasks, Blocked Tasks
- Table of all departments with task status columns
- Each department links to its detail page

> External issues/tasks (created by the WhatsApp agent) store the originating chat's phone in `tasks.source_phone` and show a **View chat ↗** link that deep-links to the inbox (`/admin/conversations?phone=…`). Issue creation is **de-duplicated**: `POST /api/issues` compares the new title+description embedding against recent open issues from the same chat and returns the existing one (`status: "duplicate"`) instead of creating a near-duplicate.

### Kanban Board (`/admin/kanban`)
- Columns: To Do, In Progress, Blocked, Done
- Filter by department, priority, assignee, and open-only/complete visibility
- Cards show title, priority badge, assignee, due date, department, and source
- Status changes use `PUT /api/tasks/[id]`
- New/edit task modal uses `POST /api/tasks` and `PUT /api/tasks/[id]`
- Archive action marks a task complete and sets `archived = true`

### Lead Inbox (`/admin/conversations`)
- Three-pane WhatsApp inbox: conversation list, message thread, and agent tool-call log
- **Conversations / Escalations tabs** — escalated threads (`escalation_status = 'pending'`) move to the Escalations tab (urgent first), with a count badge. The **De-escalate** button on an escalated chat resolves it back to Conversations. See [escalation.md](./escalation.md).
- Conversation list shows display name, last message, unread inbound count, an AI/MANUAL badge, and an ESCALATED/URGENT badge + category when escalated
- **Agent ↔ Manual toggle** per conversation switches `handling_mode` via `PUT /api/admin/conversations/[phoneE164]/mode`. `manual` pauses the AI agent so an admin handles the thread by hand
- **Edit FAQ / Prompt** quick-edit button (admin/leadership only) opens a modal ([QuickEditModal](../src/components/admin/QuickEditModal.tsx)) with three paths: **FAQ** (pick a department → edit its bucket via the shared editor, re-indexes on save), **Religious Content** (pick a topic → edit its block via `PUT /api/admin/religious-topics/[id]`), and **Prompt** (pick the agent or quality prompt → edit and save via `PUT /api/admin/prompts/[key]`)
- **Search bar** filters the conversation list by keyword across display name, phone number, and message bodies of the loaded chats
- The inbox API fetches the newest message/tool-call activity first under its response caps, then returns each loaded thread in chronological order so recently updated conversations always include their latest inbound or manual outbound message.
- Manual reply box (enabled only in Manual mode) sends a WhatsApp message via `POST /api/admin/conversations/[phoneE164]/messages`. Supports an **image attachment** (📎) with an optional caption — sent as a multipart request that uploads the image to Meta and delivers it as a WhatsApp image
- **Live updates via SSE** — the inbox subscribes to `GET /api/admin/conversations/stream` (EventSource) and refetches only when the server signals new activity, instead of polling on a timer
- **User Profile panel** (right rail, below Edit FAQ/Prompt) — when the selected sender is a registered roster member, shows their registration profile: status + family size, type (Mehman/Local), origin, accommodation (hotel/utaro), transport, arrival/departure, accessibility, special needs, khidmat interest, plus committee department assignments. Fetched per-conversation from `GET /api/admin/conversations/[phoneE164]/profile`, which strips PII server-side (**age, phone, email, and ITS are never returned**). The same profile (with age) feeds the agent's Sender Context — see [ai-agent.md](./ai-agent.md).
- Tool Calls pane lists agent actions for the thread with allowed/blocked status and arguments. To stay readable over multi-day threads, it shows only the **last 24 hours** of calls (newest first); older calls collapse behind a **"Show N historic tool calls"** toggle.
- **Dark mode** toggle (🌙/☀️) in the nav; preference persists in `localStorage("admin_theme")` and falls back to the OS preference on first load
- Restricted to `role = 'admin'` or `global_role = 'leadership_admin'`

### Escalation/Support (`/admin/escalation`)
- Admin/leadership-only management of escalation members, **scoped per department** (see [escalation.md](./escalation.md))
- Add an existing user as an escalation member **for a specific department** (membership grants Lead Inbox access). The same user can be added to multiple departments.
- Per-member **on-call hours** editor: weekly recurring time ranges (multiple per day), evaluated in America/Chicago
- **Routing:** when a chat or issue is escalated, the agent classifies its department (`escalation_department_id` / the issue's `department_id`); notifications go to **that department's on-call members only** (strict — no one is emailed if none are on-call). If no department is determined, **everyone on-call** is notified. One conversation can escalate multiple times over its life; each routes independently.
- Backed by `GET/POST /api/admin/escalation-support` (POST requires `department_id`) and `DELETE/PUT /api/admin/escalation-support/[id]`. Members live in `escalation_support_members` (now keyed by `(user_id, department_id)`).

### Analytics (`/admin/analytics`)
- Leadership/admin-only KPIs over a rolling 30-day window, served by `GET /api/admin/analytics`
- Task metrics: totals by status/priority, overdue list, and per-department breakdown (optional `department_id` filter)
- Conversation metrics: active/manual/AI conversation counts, inbound vs outbound message volume, messages-by-day series, and top agent tools

### Mumineen Roster (`/admin/mumineen`)
- Admin/leadership and IT-access page for roster import, lookup, registration gate control, and committee corrections.
- **Download template** links to `/templates/mumineen-roster-template.xlsx`, a static Excel workbook with an upload-ready `Roster` first sheet, plus `Examples` and `Instructions` sheets.
- The importer reads the first worksheet only. Keep the `Roster` sheet first and fill one row per mumin.
- Required upload columns are `Hof Id` and `Mumin Id`; optional roster/contact columns include `Fullname`, `Gender`, `Age`, `Jamaat`, `Idara`, `Category`, `Prefix`, `Title`, `Venue (Waaz)`, `City`, `Local/Mehman`, `Arr Place Date`, `Flight Code`, `Daily Trans`, `Whatsapp Link Clicked?`, `whatsapp_e164`, and `email`.
- Imports call `POST /api/admin/mumineen/import` and upsert families by `hof_its` and mumineen by `its`, preserving registration-submitted details on re-import.
- Lookup/edit uses `GET /api/admin/mumineen/search` and `POST /api/admin/mumineen/update`; edits are for existing active roster members only.

### Vectorized Data for Agent (`/admin/knowledge`)
Two tabs, each feeding a **separate vector store** so logistics and religious answers never mix.

**Tab 1 — FAQ & Guides** (department-scoped, store `logistics`):
- Upload customer-facing facts, FAQs, and guides as **CSV, Excel (.xlsx/.xls), Word (.docx), or PDF** (≤ 15 MB)
- Extracted text is chunked, embedded, and indexed into `site_content` (`page_url = knowledge://<id>`), so the WhatsApp agent answers from it via `get_site_content_faq` — same vector store as the scraped site/hotel sheet
- Document list shows status (processing/indexed/failed), chunk count, department, **who uploaded it**, and a delete action (removes the document and its vectors). Entries created from approved conversation suggestions show "Learned from chat".
- Access: **admin/leadership and department PM/HOD** (`POST/GET /api/knowledge`, `DELETE /api/knowledge/[id]`). Scanned/image-only PDFs can't be read.
- **Department is required** when uploading a document.
- **FAQ by Department** — below the document list, a button per department opens an editable notepad ([ContentBucketEditor](../src/components/admin/ContentBucketEditor.tsx) via [FaqBucketEditor](../src/components/admin/FaqBucketEditor.tsx)) holding that department's Q&A. Saving re-indexes the bucket into `site_content` (`page_url = faqbucket://<department_id>`) via `PUT /api/admin/faq-buckets/[departmentId]`; list via `GET /api/admin/faq-buckets`. Buckets live in the `faq_buckets` table (one editable doc per department). A **Sort learned FAQs into departments** button (`POST /api/admin/faq-buckets {action:"migrate"}`) classifies the loose "Learned from chat" entries into department buckets and removes the loose docs.

**Tab 2 — Religious Content** (not department-scoped, store `religious`):
- Powers the agent's `answer_religious_questions` tool — Vaaz Talaqi, Iqtibasaat, and Lisan ud Dawat word meanings. Indexed into the **dedicated `religious_content`** store, kept separate from logistics.
- Upload (`POST /api/knowledge` with `store=religious`, no department) lands in `religious_content` (`page_url = religious://doc/<id>`); the list is filtered via `GET /api/knowledge?store=religious`.
- **FAQ by Topic** — dynamic, editable topic blocks (seeded with *Vaaz Talaqi / Iqtibasaat help*, *Lisan ud Dawat word meanings*, *Guardrails / scope control*). Add (`POST /api/admin/religious-topics`), edit/save (`PUT /api/admin/religious-topics/[id]`, re-indexes to `religious://topic/<id>`), delete (`DELETE`). Topics live in the `religious_topics` table; list via `GET /api/admin/religious-topics`.
- **Lisan ud Dawat Dictionary (exact lookup)** — a CSV uploader ([LisanDictionaryUploader](../src/components/admin/LisanDictionaryUploader.tsx)) that full-replaces the `lisan_words` table (`POST /api/admin/lisan-words`; count via `GET`). This is a **structured exact lookup** (not the vector store) powering the agent's `get_lisan_word_meaning` tool, so word meanings are precise with "did you mean" fallbacks. Columns: transliteration/word, lisan, meaning, example.

### Prompt — Learn from Conversations (`/admin/prompt`)
- Admin/leadership-only section on the Prompt page that turns recent conversations into new knowledge (a manual stand-in for a future nightly cron).
- **Analyze conversations** button (with a lookback selector: 1–30 days) calls `POST /api/admin/knowledge/analyze`. It finds conversations with a **knowledge gap** — the agent's `get_site_content_faq` returned `no_indexed_match`, or a human sent a manual reply (`raw_payload.source = 'manual_admin'`) — and asks the model to draft reusable, PII-stripped Q&A FAQ entries from how each was actually answered.
- Each suggestion is **assigned a department** by the model, then **deduped against that department's FAQ bucket** (skipping anything already answered there, even if worded differently) before being queued — so only genuine gaps surface. Also deduped by normalized question key against existing pending/approved entries. Logic in `src/lib/knowledge/analyze-gaps.ts` (reusable by a cron).
- Each suggestion is **editable** (question, answer, and **department**) with **Approve** or **Reject** (`POST /api/admin/knowledge/suggestions/[id]`, list via `GET /api/admin/knowledge/suggestions`). **Approve appends the Q&A into the chosen department's FAQ bucket** and re-indexes it (see FAQ by Department above) — a department must be set to approve. Nothing is published without a human approving it.

### Department Detail (`/admin/departments/[id]`)
- Department name and task count
- Tasks table with: Title, Status, Assigned To, Due Date, Source, Updated
- Inline status dropdown for updating tasks
- "New Task" button with modal form

### Departments (`/admin/departments`)
- Admin-only Internal page for department-oriented roster management.
- Shows department tiles with create/remove department actions. Department removal is blocked when the department still has members, tasks, or milestones.
- Selecting a department shows its description, active users, department role controls, remove-from-department action, and a per-membership **Contact for Issues** checkbox.
- Users marked **Contact for Issues** receive the `assignment-notification` Postmark email and the approved Meta utility template `department_ticket_assigned` when a new issue is created for the department or an existing issue is assigned to it.

### Upload Transcript (`/admin/upload`)
- Department selector and file upload (`.txt` only)
- Locked fixed prompt preview plus editable department-specific prompt rules
- "Parse with AI" button
- Review tables grouped by milestones, tasks, and issues with New vs Update proposals
- Existing-match column showing which current milestone/task/issue an update will apply to
- Editable priority and assignee alias before applying selected events
- Checkbox selection (high confidence pre-checked)
- New members detected from the transcript are filtered against existing users and can be reviewed before adding
- "Submit Selected" applies selected creations and updates through the transcript API

### Users (`/admin/users`)
- Table of all users with inline editing for global_role and status
- Department filter narrows the list to users in that department only; department roster management now lives on `/admin/departments`.
- "Add User" button with modal form — includes an inline **Department + role** picker so a department membership is assigned at creation (defaults to the currently filtered department)
- Creating a new user with a department sends onboarding through `POST /api/admin/users/{id}/departments` with `send_welcome: true`
- Welcome email uses Postmark template alias `welcome-admin-email` with `member_name`, `department_name`, `set_password_url`, and `login_url`
- Permission matrix reference table (always visible)
- Link to department memberships for each user

### User Departments (`/admin/users/[id]/departments`)
- Current department memberships with role and status
- Add new membership (department + role selector)
- Deactivate existing memberships

### Profile (`/admin/profile`)
- Available to **any signed-in user** (Profile link in the nav).
- Edit own **display name**; email is read-only for non-admins (it's the login identity). **Admins/leadership can change their own email** (validated and checked for uniqueness).
- **Change password** — requires the correct current password; new password ≥ 8 chars. Backed by `PUT /api/admin/profile` (scrypt-hashed).

## Authentication

The dashboard uses httpOnly session-cookie auth:

1. User submits email + password to `POST /api/admin/auth`.
2. Server verifies the password hash and checks portal access via `buildPortalSessionUser` (src/lib/admin/session.ts).
3. On success, the server sets a `portal_session` httpOnly cookie (HMAC-SHA256-signed, `SameSite=Lax`, `Secure` in production, 7-day TTL). The response body returns `{ user }` only — no token is sent to the client.
4. Every subsequent admin API request is authenticated by `resolveCallerFromSession` (src/lib/api/auth.ts), which verifies the cookie signature and calls `get_user_permissions_by_id` per request — so role changes and deactivations take effect immediately without requiring a re-login.
5. Route-level authorization is enforced by `requirePortalCaller` (src/lib/api/portal-auth.ts) using the same predicates as the page gates (src/lib/admin/access.ts): returns 401 for invalid/missing session, 403 for predicate failure, 500 for infra errors.
6. `POST /api/admin/auth/logout` (public route) clears the `portal_session` cookie. The nav calls this on sign-out, then clears localStorage `admin_user` and redirects to `/admin/login`.
7. All admin pages share a cookie-based `apiFetch` helper (src/lib/admin/client.ts). A 401 response automatically clears `admin_user` from localStorage and redirects to `/admin/login`, so stale sessions (e.g. after a re-deploy that rotates `SESSION_SECRET`) result in a clean re-login prompt.
8. The SSE inbox stream (`GET /api/admin/conversations/stream`) and media image proxies authenticate via the session cookie — no `?key=` query params.

`ADMIN_API_KEY` (`x-admin-key` header) is **server-to-server only** — it is used by agent tools and cron jobs, never sent to the browser.

## Environment Variables

- `SESSION_SECRET` — Signs portal session cookies (HMAC-SHA256). Falls back to `ADMIN_API_KEY` if unset; set a dedicated value in production.
- `ADMIN_API_KEY` — Server-to-server auth for agent tools and cron jobs. Never sent to the browser.

## Security Notes

- Admin routes are protected by `requirePortalCaller`, which enforces session-cookie auth and per-route permission predicates mirroring the page gates.
- Per-request permission resolution via `get_user_permissions_by_id` RPC means role changes and deactivations take effect immediately.
- `ADMIN_API_KEY` must never be exposed to the client. Rotate it after deploying this migration — the old value was previously bundled as `NEXT_PUBLIC_ADMIN_KEY`.
- All database operations use the Supabase service role client (bypasses RLS); access is gated at the API layer.
