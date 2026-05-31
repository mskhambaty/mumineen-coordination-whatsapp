# Admin Dashboard

## Overview

The admin dashboard provides a web interface for managing tasks, departments, users, and transcript uploads. It's built with React (Next.js App Router) and Tailwind CSS.

## Pages

### Login (`/admin/login`)
- Email and password authentication
- Forgot password link that calls `POST /api/auth/forgot-password`
- Default password: `786110`
- Only users with `role = 'admin'` or `global_role = 'leadership_admin'` can log in
- Primary admin: mskhambaty@gmail.com (Mufaddal Khambaty)

### Dashboard Home (`/admin`)
- Count cards: Total Departments, Total Tasks, Open Tasks, Blocked Tasks
- Table of all departments with task status columns
- Each department links to its detail page

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
- Manual reply box (enabled only in Manual mode) sends a WhatsApp message via `POST /api/admin/conversations/[phoneE164]/messages`
- **Live updates via SSE** — the inbox subscribes to `GET /api/admin/conversations/stream` (EventSource) and refetches only when the server signals new activity, instead of polling on a timer
- Tool Calls pane lists agent actions for the thread with allowed/blocked status and arguments
- **Dark mode** toggle (🌙/☀️) in the nav; preference persists in `localStorage("admin_theme")` and falls back to the OS preference on first load
- Restricted to `role = 'admin'` or `global_role = 'leadership_admin'`

### Escalation/Support (`/admin/escalation`)
- Admin/leadership-only management of the support team (see [escalation.md](./escalation.md))
- Add an existing user as a support member (membership = the `escalation/support` role, granting Lead Inbox access)
- Per-member **on-call hours** editor: weekly recurring time ranges (multiple per day), evaluated in America/Chicago — only on-call members are alerted about escalations
- Backed by `GET/POST /api/admin/escalation-support` and `DELETE/PUT /api/admin/escalation-support/[id]`

### Analytics (`/admin/analytics`)
- Leadership/admin-only KPIs over a rolling 30-day window, served by `GET /api/admin/analytics`
- Task metrics: totals by status/priority, overdue list, and per-department breakdown (optional `department_id` filter)
- Conversation metrics: active/manual/AI conversation counts, inbound vs outbound message volume, messages-by-day series, and top agent tools

### FAQ & Guides (`/admin/knowledge`)
- Upload customer-facing facts, FAQs, and guides as **CSV, Excel (.xlsx/.xls), Word (.docx), or PDF** (≤ 15 MB)
- Extracted text is chunked, embedded, and indexed into `site_content` (`page_url = knowledge://<id>`), so the WhatsApp agent answers from it via `get_site_content_faq` — same vector store as the scraped site/hotel sheet
- Document list shows status (processing/indexed/failed), chunk count, department, and a delete action (removes the document and its vectors)
- Access: **admin/leadership and department PM/HOD** (`POST/GET /api/knowledge`, `DELETE /api/knowledge/[id]`). Scanned/image-only PDFs can't be read.

### Department Detail (`/admin/departments/[id]`)
- Department name and task count
- Tasks table with: Title, Status, Assigned To, Due Date, Source, Updated
- Inline status dropdown for updating tasks
- "New Task" button with modal form

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
- "Add User" button with modal form
- Permission matrix reference table (always visible)
- Link to department memberships for each user

### User Departments (`/admin/users/[id]/departments`)
- Current department memberships with role and status
- Add new membership (department + role selector)
- Deactivate existing memberships

## Authentication

The dashboard uses a simple token-based auth:
1. User submits email + password to `POST /api/admin/auth`
2. Server validates credentials and checks role
3. Token stored in localStorage
4. Admin API routes require `x-admin-key` header (from `ADMIN_API_KEY` env var)

## Environment Variables

- `ADMIN_API_KEY` — Required for admin API route access
- `NEXT_PUBLIC_ADMIN_KEY` — Same key, exposed to client for fetch calls

## Security Notes

- The login system uses a simple shared password for initial deployment
- Admin routes are protected by the `x-admin-key` header
- The `requireAdminKey()` middleware validates the key against `ADMIN_API_KEY`
- All database operations use the service role client (bypasses RLS)
