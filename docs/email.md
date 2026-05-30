# Email

Postmark sends all portal email through `src/lib/email/postmark.ts`. The module is server-only and uses the Postmark template endpoint with the outbound transactional stream.

## Environment

| Variable | Purpose |
|----------|---------|
| `POSTMARK_API_TOKEN` | Postmark server API token. Rotate any token shared in chat or docs before production use. |
| `POSTMARK_FROM_EMAIL` | Sender address, e.g. `info@cysora.com`. |
| `POSTMARK_PASSWORD_RESET_TEMPLATE` | Template alias for password reset email. |
| `POSTMARK_TASK_NOTIFICATION_TEMPLATE` | Template alias for task digest email. |
| `NEXT_PUBLIC_APP_URL` | Public base URL for links back to the portal. |

## Password Reset

`POST /api/auth/forgot-password` accepts `{ "email": "user@example.com" }`, uses Supabase Auth admin `generateLink({ type: "recovery" })`, then sends the generated link through Postmark. The route always returns `{ "ok": true }` so callers cannot enumerate users.

Password reset template alias: `password-reset`

No template change is required for the role/department updates. The template model is still:

| Field | Value |
|-------|-------|
| `name` | User display name or fallback name |
| `product_name` | `Anjuman e Saifee Chicago Portal` |
| `action_url` | Supabase recovery link |
| `operating_system` | `Unknown` |
| `browser_name` | `Unknown` |
| `support_url` | `${NEXT_PUBLIC_APP_URL}/admin` |

```html
<h1>Hi {{name}},</h1>
<p>You recently requested to reset your password for your <strong>{{product_name}}</strong> account.
Use the button below to reset it. <strong>This link is only valid for the next 24 hours.</strong></p>
<table align="center" cellpadding="0" cellspacing="0">
  <tr><td align="center">
    <a href="{{action_url}}" style="background:#1a56db;color:#fff;padding:12px 24px;
       border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
      Reset your password
    </a>
  </td></tr>
</table>
<p>If you did not request a password reset, please ignore this email or
<a href="{{support_url}}">contact support</a>.</p>
<p>Thanks,<br>The {{product_name}} Team</p>
<p style="font-size:12px;color:#666;">
  If the button above doesn't work, copy and paste this URL into your browser:<br>
  {{action_url}}
</p>
```

Plain text:

```text
Hi {{name}},

You recently requested to reset your password for your {{product_name}} account.
Use this link to reset it. This link is only valid for the next 24 hours:

{{action_url}}

If you did not request a password reset, ignore this email or contact support:
{{support_url}}

Thanks,
The {{product_name}} Team
```

## Daily Digest

`GET/POST /api/cron/daily-digest` is protected by `Authorization: Bearer ${CRON_SECRET}` and scheduled in `vercel.json` for `0 7 * * *`. It sends active users with `email_digest = true` a scoped list of open, in-progress, and blocked tasks:

- account `role = 'admin'` or `global_role = 'leadership_admin'`: all incomplete tasks
- department `pm` / `hod`: incomplete tasks in the user's active PM/HOD departments
- department `member`: incomplete tasks assigned to that user

Task digest template alias: `tasks-notification`

No template variable change is required for the role/department updates. The digest template model is still:

| Field | Value |
|-------|-------|
| `name` | User display name or `there` |
| `tasks` | Array of scoped incomplete tasks |
| `tasks[].title` | Task/ticket title |
| `tasks[].department` | Department name |
| `tasks[].priority` | `low`, `medium`, or `high` |
| `tasks[].status` | `open`, `in_progress`, `blocked`, or `complete` |
| `tasks[].due_date` | Due date when present |
| `action_url` | Kanban board URL |
| `notifications_url` | Kanban board URL for now |

The current template still works if it uses the fields above. Use this refreshed version if you want Postmark wording to match ticket/task language:

```html
<h1>Hi {{name}},</h1>
<p>Here is your ticket and task summary for today:</p>
<table width="100%" cellpadding="8" cellspacing="0"
       style="border-collapse:collapse;font-size:14px;">
  <thead>
    <tr style="background:#f3f4f6;">
      <th align="left" style="border-bottom:1px solid #e5e7eb;">Task</th>
      <th align="left" style="border-bottom:1px solid #e5e7eb;">Department</th>
      <th align="left" style="border-bottom:1px solid #e5e7eb;">Priority</th>
      <th align="left" style="border-bottom:1px solid #e5e7eb;">Status</th>
      <th align="left" style="border-bottom:1px solid #e5e7eb;">Due</th>
    </tr>
  </thead>
  <tbody>
    {{#each tasks}}
    <tr>
      <td style="border-bottom:1px solid #f3f4f6;">{{title}}</td>
      <td style="border-bottom:1px solid #f3f4f6;">{{department}}</td>
      <td style="border-bottom:1px solid #f3f4f6;">{{priority}}</td>
      <td style="border-bottom:1px solid #f3f4f6;">{{status}}</td>
      <td style="border-bottom:1px solid #f3f4f6;">{{due_date}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
<br>
<table align="center" cellpadding="0" cellspacing="0">
  <tr><td align="center">
    <a href="{{action_url}}" style="background:#1a56db;color:#fff;padding:12px 24px;
       border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
      View Open Tickets
    </a>
  </td></tr>
</table>
<p style="font-size:12px;color:#666;">
  <a href="{{notifications_url}}">Manage your task notifications</a>
</p>
```

Plain text:

```text
Hi {{name}},

Here is your ticket and task summary for today:

{{#each tasks}}
- {{title}}
  Department: {{department}}
  Priority: {{priority}}
  Status: {{status}}
  Due: {{due_date}}
{{/each}}

View open tickets:
{{action_url}}

Manage your task notifications:
{{notifications_url}}
```
