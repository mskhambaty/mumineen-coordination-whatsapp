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

### Department Detail (`/admin/departments/[id]`)
- Department name and task count
- Tasks table with: Title, Status, Assigned To, Due Date, Source, Updated
- Inline status dropdown for updating tasks
- "New Task" button with modal form

### Upload Transcript (`/admin/upload`)
- Department selector and file upload (`.txt` only)
- Locked fixed prompt preview plus editable department-specific prompt rules
- "Parse with AI" button
- Review table showing parsed events with confidence scores
- Editable priority and assignee alias before applying selected events
- Checkbox selection (high confidence pre-checked)
- New members detected from the transcript can be reviewed and added immediately
- "Apply Selected" button creates tasks from selected events

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
