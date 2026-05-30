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

| Tool | visitor | committee | admin |
|------|---------|-----------|-------|
| `get_event_schedule` | ✅ | ✅ | ✅ |
| `get_parking_info` | ✅ | ✅ | ✅ |
| `get_directions` | ✅ | ✅ | ✅ |
| `get_faq_answer` | ✅ | ✅ | ✅ |
| `get_lost_found_info` | ✅ | ✅ | ✅ |
| `get_volunteer_assignment` | ❌ | ✅ | ✅ |
| `lookup_committee_contact` | ❌ | ✅ | ✅ |
| `update_volunteer_status` | ❌ | ✅ | ✅ |
| `create_internal_note` | ❌ | ✅ | ✅ |

Task tools first require `committee` or `admin` in the WhatsApp tool layer, then apply department role/global access:

| Tool | member | pm | hod | leadership_admin |
|------|--------|----|-----|------------------|
| `get_my_tasks` | ✅ | ✅ | ✅ | ✅ |
| `get_task_detail` | ✅ | ✅ | ✅ | ✅ |
| `get_department_summary` | ✅ | ✅ | ✅ | ✅ |
| `update_task_status` | ❌ | ✅ | ✅ | ✅ |
| `create_task` | ✅ | ✅ | ✅ | ✅ |
| `assign_task` | ❌ | ✅ | ✅ | ✅ |
| `get_top_blockers` | ❌ | ✅ | ✅ | ✅ |
| `get_all_departments_summary` | ❌ | ❌ | ❌ | ✅ |
| `get_department_tasks` | ❌ | ❌ | ❌ | ✅ |

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

## Adding a New Permission Level

If you need a new role (e.g., `moderator`):
1. Add it to the `UserRole` union type in `permissions.ts`.
2. Add it to the `role` column check constraint in a new Supabase migration.
3. Define which tools it can access in `canUseTool()`.
4. Update the matrix in this doc and [ai-agent.md](./ai-agent.md).
