# Task Management System

## Overview

The task management system adds project coordination capabilities to the WhatsApp assistant. It allows committee members to create, track, and update tasks across departments, with role-based access control.

## Architecture

### Data Model

- **departments** — Fixed list of organizational departments (e.g., Accommodation, AVR, Transport)
- **department_members** — Links users to departments with a role (hod, pm, member)
- **tasks** — Individual work items with status, priority, archive flag, department assignment, and optional assignee
- **conversation_uploads** — Raw WhatsApp transcript files uploaded for AI parsing
- **conversation_events** — Parsed actionable items extracted from transcripts

### Role Hierarchy

| Role | Description | Access |
|------|-------------|--------|
| `member` | Basic committee member | View own dept tasks and summaries |
| `pm` | Project Manager | Create/update tasks in own departments |
| `hod` | Head of Department | Same as PM |
| `leadership_admin` | Leadership / Admin | Full access to all departments and tasks |

Note: `leadership` and `admin` are merged into a single role called `leadership_admin`.

### Global Role vs WhatsApp Role

- **`role`** column (`visitor`/`committee`/`admin`): Controls access to the existing WhatsApp public/committee tool layer
- **`global_role`** column (`member`/`pm`/`hod`/`leadership_admin`): Controls access to the new task management layer

Both columns coexist on `whatsapp_users` for backward compatibility.

## API Routes

### Task Routes
- `GET /api/tasks` — List tasks (scoped by caller's departments)
- `GET /api/tasks/kanban` — List tasks grouped by status for the kanban board
- `GET /api/tasks/[id]` — Get single task detail
- `POST /api/tasks` — Create a new task
- `PUT /api/tasks/[id]` — Update a task

Task list routes accept `priority=low|medium|high|all`. By default archived tasks are excluded.

### Ticket Visibility in Nightly Digest

Open ticket counts and top titles are included in the nightly department digest
(`/api/cron/department-digest`, 10pm Chicago). Each department's AI briefing
mentions its open tickets, and the all-up summary shows the total across departments.
See [meal-rsvp-feedback-digest.md](./meal-rsvp-feedback-digest.md) §3 for details.

### Department Routes
- `GET /api/departments` — List departments; authenticated committee chat/portal callers see the
  full directory, while non-internal callers remain scoped
- `GET /api/departments/[id]/members` — List active assignment-eligible members without phone/email PII
- `POST /api/departments` — Create a department (admin only)
- `PUT /api/departments/[id]` — Update department description (admin only)
- `DELETE /api/departments/[id]` — Remove an unused department (admin only; blocked if members/tasks/milestones exist)
- `GET /api/departments/[id]/tasks` — Tasks in a department
- `GET /api/departments/[id]/summary` — Task counts by status
- `GET /api/departments/summary/all` — All departments summary (leadership only)

### User Routes
- `GET /api/users/me` — Current user's profile and permissions
- `GET /api/users/resolve?alias=` — Resolve a name to a user
- `POST /api/users/bulk-create` — Create users and memberships from transcript-detected member aliases

### Transcript Routes
- `POST /api/transcripts/upload` — Upload and parse a transcript
- `GET /api/transcripts/[id]/events` — Get parsed events
- `POST /api/transcripts/[id]/apply` — Apply selected events as tasks
- `GET/PUT /api/departments/[id]/prompt-config` — Read and update department transcript parser rules

### Admin Routes
- `POST /api/admin/auth` — Admin login
- `GET/POST /api/admin/users` — List/create users
- `GET/PUT /api/admin/users/[id]` — Get/update user
- `GET/POST /api/admin/users/[id]/departments` — Manage memberships
- `PUT /api/admin/users/[id]/departments/[membershipId]` — Update membership role/status and the per-department `contact_for_issues` flag

### Issue Contact Notifications

Each `department_members` row has `contact_for_issues` (default `false`). When an issue is created with a department, or an existing issue is moved to a department, active members of that department with `contact_for_issues = true` receive:
- Postmark `assignment-notification` email
- Meta WhatsApp utility template `department_ticket_assigned` with issue title, description, and portal link

Notification failures are logged and do not block issue creation.

## Authentication

API routes accept authentication via:
1. `x-whatsapp-from` header — Phone number in E.164 format (for WhatsApp agent calls)
2. `x-admin-key` header — API key matching `ADMIN_API_KEY` env var (for admin dashboard)

The `get_user_permissions` SQL function resolves a phone number to a full CallerContext including global role and department memberships.

## WhatsApp Agent Tools

New task management tools added to the agent:

### Read Tools
- `list_tasks` — List/filter every ticket the caller can access; always returns ticket IDs
- `list_departments` — List departments available to the caller
- `list_department_members` — List active members eligible for assignment, without phone/email PII

### Write Tools
- `create_task` — Create a new task with optional priority and assignee
- `update_tasks` — Resolve one or many tickets internally and update status, priority, title,
  description, department, assignee, due date, type, or archive state

`update_tasks` exists because the agent runs one bounded tool-call round per inbound message.
It can safely resolve IDs from explicit IDs, topic keywords, current department/status/priority,
and exclusions before applying an authorized update. Bulk updates require `all_matching=true`,
which the agent is instructed to set only when the user explicitly asks to update every match.
The response reports matched, updated, and failed counts so the agent cannot honestly claim a
partial or failed update succeeded.

## Transcript Parser

The transcript parser (`src/lib/transcripts/parser.ts`) processes WhatsApp .txt exports:
1. Chunks content if > 24000 characters (splits on date boundaries)
2. Sends each chunk to OpenAI with structured extraction prompt
3. Returns events with confidence scores
4. Only includes events with confidence >= 0.5
5. Events can be reviewed and selectively applied as tasks

## Admin Dashboard

Available at `/admin`:
- **Login** (`/admin/login`) — Email + password authentication
- **Dashboard** (`/admin`) — Department overview with task counts
- **Department Detail** (`/admin/departments/[id]`) — Tasks table with inline status updates
- **Departments** (`/admin/departments`) — Department tiles, roster management, and issue-contact notification flags
- **Kanban Board** (`/admin/kanban`) — Status-column task board with priority, assignee, department, due-date, filters, create/edit modal, and archive action
- **Upload** (`/admin/upload`) — Transcript parsing and event review
- **Users** (`/admin/users`) — User management with permission matrix
- **User Departments** (`/admin/users/[id]/departments`) — Department membership management
