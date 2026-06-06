# Email

Postmark sends all portal email through `src/lib/email/postmark.ts`. The module is server-only and uses the Postmark template endpoint with the outbound transactional stream.

## Environment

| Variable | Purpose |
|----------|---------|
| `POSTMARK_API_TOKEN` | Postmark server API token. Rotate any token shared in chat or docs before production use. |
| `POSTMARK_FROM_EMAIL` | Sender address, e.g. `info@cysora.com`. |
| `POSTMARK_PASSWORD_RESET_TEMPLATE` | Template alias for password reset email. Defaults to `password-reset`. |
| `POSTMARK_WELCOME_ADMIN_TEMPLATE` | Template alias for new portal user welcome invites. Defaults to `welcome-admin-email`. |
| `POSTMARK_TASK_NOTIFICATION_TEMPLATE` | Template alias for task digest email. |
| `NEXT_PUBLIC_APP_URL` | Public base URL for links back to the portal. |

## Password Reset

`POST /api/auth/forgot-password` accepts `{ "email": "user@example.com" }`, creates an app-owned one-hour reset token on `whatsapp_users`, and sends the reset link through Postmark. The route always returns `{ "ok": true }` so callers cannot enumerate users.

Password reset template alias: `password-reset`

No template change is required for the role/department updates. The template model is still:

| Field | Value |
|-------|-------|
| `name` | User display name or fallback name |
| `product_name` | `Anjuman e Saifee Chicago Portal` |
| `action_url` | `${NEXT_PUBLIC_APP_URL}/admin/reset-password?token=...` |
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

`POST /api/auth/reset-password` accepts `{ "token": "...", "password": "..." }`, stores the new password hash, clears the reset token, and returns the same local portal session payload as `POST /api/admin/auth`:

```json
{
  "ok": true,
  "token": "...",
  "user": {
    "id": "...",
    "display_name": "Member Name",
    "email": "member@example.com",
    "role": "committee",
    "global_role": "member",
    "is_support": false,
    "is_manager": true,
    "is_it": false
  }
}
```

## New Portal User Welcome

When the admin Users page creates a new user and department membership, it calls `POST /api/admin/users/{id}/departments` with `send_welcome: true`. The welcome logic lives in [`src/lib/admin/onboarding.ts`](../src/lib/admin/onboarding.ts) (`sendAdminWelcomeNotification`): it creates a password setup link using the same reset-token flow, sends the `welcome-admin-email` Postmark template when the user has an email address, and sends a WhatsApp welcome when the user has a phone number.

Template model for `welcome-admin-email`:

| Field | Value |
|-------|-------|
| `member_name` | User display name or `there` |
| `department_name` | Department name |
| `set_password_url` | `${NEXT_PUBLIC_APP_URL}/admin/reset-password?token=...` |
| `login_url` | `https://www.chicagorelaycenter.com/admin/login` when `NEXT_PUBLIC_APP_URL=https://www.chicagorelaycenter.com` |

**WhatsApp welcome — approved template.** The WhatsApp welcome is sent as the approved utility template `committee_platform_access_created`, not free-form text. A template delivers whether or not the recipient has an open 24h customer-service window, and Meta does not charge for utility templates sent inside an open window — so it is sent unconditionally. The template language is resolved live from Meta (via `listMessageTemplates()`), so it works regardless of how the template's locale is registered. Its body mirrors the email and carries four variables:

| Var | Value |
|-----|-------|
| `{{1}}` | Member display name (or `there`) |
| `{{2}}` | Committee(s) the user is active in — see "Committee variable" below |
| `{{3}}` | Password-setup link (`${NEXT_PUBLIC_APP_URL}/admin/reset-password?token=...`), same flow as the email |
| `{{4}}` | Admin portal login — hard-coded to `https://www.chicagorelaycenter.com/admin/login` |

The send is recorded in the inbox as `[template:committee_platform_access_created] …` (with `{{n}}` substituted) and `source: "admin_welcome"`.

**Committee variable.** `{{2}}` is built at send time from *all* of the user's active department memberships (`formatCommittees`: `"A"`, `"A and B"`, `"A, B, and C"`), falling back to the triggering department name when there are none. This avoids any delayed/debounced job: a member added to several committees before the welcome fires sees them all. In the common Add-User flow the welcome fires on the single creation-time membership, so it lists just that one; later additions don't re-welcome (see below), but a manual re-send will list everything the member now belongs to.

**Once per user.** `whatsapp_users.welcomed_at` records the first successful welcome. The automatic add-to-department path welcomes each user only once — adding an already-welcomed user to additional departments returns `already_welcomed: true` and sends nothing. The timestamp is stamped only when at least one channel (email or WhatsApp) actually delivered, so a transient failure doesn't permanently suppress the welcome. The manual "Send welcome" action (`POST /api/admin/users/{id}/welcome`) sets `force: true` to bypass this guard, so an admin can re-send on request (e.g. a member who lost their original link).

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
