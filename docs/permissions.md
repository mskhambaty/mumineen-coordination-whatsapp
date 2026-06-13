# Permissions

## Overview

Role-based access is enforced in two places:
1. **Runtime** — `canUseTool()` in `src/lib/permissions.ts` before every tool execution.
2. **Task/API routes** — account role plus `department_members.dept_role` scopes task access.
3. **Database** — `role`, `global_role`, and department memberships are the source of truth; the server reads them and never trusts user claims.

## User Roles

| Role | Description |
|------|-------------|
| `visitor` | Default for all new users. Public tools only. |
| `committee` | Authorized event coordinators. Public + committee tools. |
| `admin` | Leadership/admin account. Public + committee tools, with full task access. |

A user's role is set in the `whatsapp_users` table. New users default to `visitor`.

Task management primarily uses department memberships: `member`, `pm`, or `hod` in `department_members.dept_role`. Department members see assigned tasks and can create self-assigned tickets in their active departments. PM/HOD users can create, assign, and update tasks in their active departments. Account `role = 'admin'` or `global_role = 'leadership_admin'` grants full cross-department access.

To promote a number to committee:

```sql
update public.whatsapp_users
set role = 'committee'
where phone_e164 = '+13125551212';
```

## User Status

A user with `status = 'inactive'` cannot use **any** tool, regardless of role.  
`canUseTool()` checks status first.

Possible status values: `active` (default), `inactive`.

## Tool Access Matrix

Public tools (the `publicTools` set in `src/lib/permissions.ts`) are available to every role:

| Tool | visitor | committee | admin |
|------|---------|-----------|-------|
| `get_site_content_faq` | ✅ | ✅ | ✅ |
| `answer_religious_questions` | ✅ | ✅ | ✅ |
| `get_lisan_word_meaning` | ✅ | ✅ | ✅ |
| `move_to_escalation` | ✅ | ✅ | ✅ |
| `create_issue` | ✅ | ✅ | ✅ |
| `flag_knowledge_gap` | ✅ | ✅ | ✅ |
| `get_family_meal_rsvps` | ✅ | ✅ | ✅ |
| `set_family_meal_rsvps` | ✅ | ✅ | ✅ |

There are no committee-only agent tools (the unimplemented volunteer/committee/note stubs were
removed in June 2026). Internal capability for committee/admin is the task tools below, which
first require `committee` or `admin` in the WhatsApp tool layer, then apply department role/global access:

| Tool | member | pm | hod | leadership_admin |
|------|--------|----|-----|------------------|
| `list_tasks` | ✅ | ✅ | ✅ | ✅ |
| `list_departments` | ✅ | ✅ | ✅ | ✅ |
| `list_department_members` | ✅ | ✅ | ✅ | ✅ |
| `update_tasks` | ❌ | ✅ | ✅ | ✅ |
| `create_task` | ✅ | ✅ | ✅ | ✅ |

## `canUseTool()` Logic

```
if user.status !== 'active'  → deny
if tool in publicTools       → allow
if tool in committeeTools && role in ['committee', 'admin'] → allow
else → deny
```

Source: `src/lib/permissions.ts`

## Audit Logging

Every tool call — allowed or denied — is written to the `tool_audit_logs` table with:
- `user_id`, `phone_e164`
- `tool_name`, `arguments`
- `allowed` (boolean)
- `result_summary` (first 500 chars of result)

See [database.md](./database.md) for the full schema.

`list_department_members` returns only user ID, display name, and department role. Phone numbers
and email addresses are deliberately excluded from the agent response.

## Portal (Admin Dashboard) Enforcement

> **The full role × page matrix lives in [access-control.md](./access-control.md).**
> This section covers the enforcement mechanism; that doc is the canonical list of
> which pages/actions each role can reach.

The admin dashboard enforces permissions server-side using the same `CallerContext` and permission engine as the WhatsApp agent:

- **Cookie auth:** every `src/app/api/admin/**` route resolves the caller via `resolveCallerFromSession` (src/lib/api/auth.ts), which verifies the HMAC-signed `portal_session` cookie and calls `get_user_permissions_by_id` per request. Role changes and deactivations take effect immediately.
- **Route guard:** `requirePortalCaller(req, predicate)` (src/lib/api/portal-auth.ts) enforces the same predicates defined in the page gate (src/lib/admin/access.ts). Returns 401 for invalid/missing session, 403 for predicate failure.
- **Access tiers** (src/lib/admin/access.ts):
  - `canAccessPortal` — **baseline internal-staff tier**: any portal login (committee or admin). Home, the Mumineen pages (view), Registration/Accommodations, the Workspace pages (dept-scoped content), and all of Member Management gate on this.
  - `canAccessInbox` — admin/leadership or on-call support (`is_support`).
  - `canManageKnowledge` — admin/leadership or department PM/HOD (`is_manager`); the AI-agent knowledge tools.
  - `isAdminOrLeadership` — admin/leadership only; Messaging, Prompts, Model Testing, and heavy-PII roster actions (full CSV export, member create, registration-gate).
  - `canImportMumineen` (admin/leadership or IT) and `canManageParking` (admin/leadership, IT, Transport) — the tighter write tiers for bulk roster import and parking pass writes/export.
- **Admin-promotion carve-out:** all portal users can add/edit users and assign departments, but **only admin/leadership may grant or change the Admin/Leadership account role** — enforced in the `/admin/users` UI and in `POST /api/admin/users` + `PUT /api/admin/users/[id]` (403 otherwise).
- **Front door (`canAccessPortal`):** sign-in (`POST /api/admin/auth`), `forgot-password`, and `reset-password` gate on `canAccessPortal(user)` — true for **any non-visitor user** (`role` `committee` or `admin`), regardless of department assignment. Visitors (the public/mumineen) are rejected.
- **`x-admin-key` is server-to-server only:** agent tools and cron jobs send `x-admin-key` (from `ADMIN_API_KEY`), which bypasses the cookie check and passes every guard. This header must never be sent by browser clients.

## Adding a New Permission Level

If you need a new role (e.g., `moderator`):
1. Add it to the `UserRole` union type in `permissions.ts`.
2. Add it to the `role` column check constraint in a new Supabase migration.
3. Define which tools it can access in `canUseTool()`.
4. Update the matrix in this doc and [ai-agent.md](./ai-agent.md).
