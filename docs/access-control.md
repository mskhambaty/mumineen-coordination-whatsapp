# Access Control — Portal Role × Page Matrix

> **Canonical source for who can see and do what in the `/admin` portal.**
> The runtime source of truth is [`src/lib/admin/access.ts`](../src/lib/admin/access.ts)
> (the predicates) and [`src/components/admin/AdminNav.tsx`](../src/components/admin/AdminNav.tsx)
> (nav visibility). Every gate is enforced **server-side** by `requirePortalCaller`
> (see [permissions.md](./permissions.md)); the nav only hides links it knows the
> user can't use. If this doc and the code disagree, the code wins — fix one of them.

## The two axes

Access is the combination of an **account role** and any **department roles**. They are
independent: a person's department role does not change their account role and vice versa.

### Account role (`whatsapp_users.role` / `global_role`)

| Term used here | In the data | Meaning |
|---|---|---|
| **Admin / Leadership** | `role = 'admin'` **or** `global_role = 'leadership_admin'` | Full access to every page and action. Passes every predicate. |
| **Committee** | `role = 'committee'` | A portal login ("portal user"). This is the **baseline internal-staff tier** — see the "open to all portal users" rows below. Real capability beyond the baseline comes from department roles. |
| **Visitor** | `role = 'visitor'` | The public / mumineen. **No portal access at all.** |

### Department role (`department_members.dept_role`, per department)

| Department role | Derived portal flags ([session.ts](../src/lib/admin/session.ts)) |
|---|---|
| **HOD** / **PM** | `is_manager = true`, `is_internal = true` |
| **Member** | `is_internal = true` |
| (in IT dept) | `is_it = true` · (in Transport dept) `is_transport = true` |
| (added to escalation/on-call) | `is_support = true` — any account/department role can be added |
| (added to religious monitors) | `is_religious_monitor = true` — any account role can be added; a monitor with no other portal access (e.g. a `visitor`) can sign in but sees ONLY `/admin/religious` |

## Access tiers (predicates)

| Tier | Predicate | Who |
|---|---|---|
| **portal** | `canAccessPortal` | Any portal login (committee or admin). The baseline internal-staff tier. |
| **inbox** | `canAccessInbox` | Admin/leadership **or** on-call/escalation members (`is_support`). |
| **manage** | `canManageKnowledge` | Admin/leadership **or** department PM/HOD (`is_manager`) **or** escalation/on-call (`is_support`). |
| **admin** | `isAdminOrLeadership` | Admin/leadership only. |
| **import** | `canImportMumineen` | Admin/leadership **or** IT (`is_it`). Bulk roster import only. |
| **parking-write** | `canManageParking` | Admin/leadership, IT, or Transport. Parking assign/revoke/export only. |
| **religious** | `canMonitorReligiousChats` | Admin/leadership **or** a religious monitor (`is_religious_monitor`). The isolated `/admin/religious` dashboard only. |

## Page matrix

✅ = full access · 👁 = page/read open, heavy writes still gated · ❌ = no access

| Nav group → Page | Admin / Leadership | Committee (no dept) | Member | PM / HOD | Notes |
|---|---|---|---|---|---|
| **Home** (`/admin`) | ✅ | ✅ | ✅ | ✅ | Aggregate analytics only. |
| **Inbox** (`/admin/conversations`) | ✅ | ❌ | ❌ | ❌ | …unless added to escalation/on-call (`is_support`), then ✅. Anyone can add themselves on the Escalation page. *Edit FAQ/Prompt quick-edit stays admin/leadership only.* |
| **Mumineen → Roster** | ✅ | 👁 | 👁 | 👁 | View/lookup/edit/create open to all portal users. **Bulk import** = import tier; **full CSV export, registration-gate** = admin tier. |
| **Mumineen → Registration Analytics** | ✅ | ✅ | ✅ | ✅ | Includes drill-down detail + per-segment CSV. Mass registrant export remains admin tier. |
| **Mumineen → Accommodations** | ✅ | ✅ | ✅ | ✅ | Host/guest views + matching. |
| **Mumineen → Parking Passes** | ✅ | 👁 | 👁 | 👁 | View open to all portal users. **Assign/revoke/edit lots/export** = parking-write tier (admin, IT, Transport). |
| **Mumineen → Niyaz** | ✅ | ✅ | ✅ | ✅ | |
| **Messaging → Relay Updates** | ✅ | ❌ | ❌ | ❌ | Admin/leadership only (view + edit). |
| **Messaging → WhatsApp Templates** | ✅ | ❌ | ❌ | ❌ | Admin/leadership only (view + edit). |
| **AI Agent → Prompts** | ✅ | ❌ | ❌ | ✅ | manage tier (includes escalation/on-call). |
| **AI Agent → Knowledge Base** | ✅ | ✅ | ✅ | ✅ | portal tier (any signed-in user). |
| **AI Agent → Knowledge Gaps** | ✅ | ❌ | ❌ | ✅ | manage tier. |
| **AI Agent → Ashara Daily Content** | ✅ | ❌ | ❌ | ✅ | manage tier. |
| **AI Agent → Model Testing** | ✅ | ❌ | ❌ | ❌ | Admin/leadership only. |
| **Workspace → Tasks** | ✅ | ✅ (empty) | ✅ (own depts) | ✅ (own depts) | Page open to all; **content is dept-scoped** server-side — a deptless user sees empty lists. Task create/assign/update still governed by dept role. |
| **Workspace → Milestones** | ✅ | ✅ (empty) | ✅ (own depts) | ✅ (own depts) | Dept-scoped like Tasks. |
| **Workspace → Daily Digest** | ✅ | ✅ (empty) | ✅ (own depts) | ✅ (own depts) | Dept-scoped. |
| **Workspace → Upload Transcripts** | ✅ | ✅ | ✅ | ✅ | Page open; applying parsed tasks/milestones still needs dept write permission. |
| **Member Mgmt → Users** | ✅ | ✅\* | ✅\* | ✅\* | \*All portal users can add/edit users and assign departments. **Only admin/leadership may grant or change the Admin/Leadership account role** (enforced in the UI *and* in `PUT`/`POST /api/admin/users`). Deleting users and setting another user's password remain admin/leadership only. |
| **Member Mgmt → Departments** | ✅ | ✅ | ✅ | ✅ | Create/edit/remove departments and manage memberships. |
| **Member Mgmt → Escalation & On-call** | ✅ | ✅ | ✅ | ✅ | Anyone can add themselves (or others) to on-call, which unlocks the Inbox. |
| **Profile** (`/admin/profile`) | ✅ | ✅ | ✅ | ✅ | Any signed-in user. Email is editable only by admin/leadership. |

## The one carve-out: granting Admin/Leadership

Everyone who can reach Member Management can add users and assign them to departments
(including adding **themselves** to other departments). The **only** restricted action is
**setting an account role to admin/leadership** (`role = 'admin'` or
`global_role = 'leadership_admin'`):

- **UI:** the Account Role control on `/admin/users` is locked to Committee for non-admins.
- **Server:** `POST /api/admin/users` and `PUT /api/admin/users/[id]` reject a non-admin
  caller that tries to create, promote to, or modify a holder of admin/leadership access
  (403). A non-admin also cannot demote/edit an existing admin.

## Changing access

1. Edit the predicate in [`src/lib/admin/access.ts`](../src/lib/admin/access.ts) (one place).
2. Retag the nav item's `access` in [`AdminNav.tsx`](../src/components/admin/AdminNav.tsx) and the
   page-gate predicate in the page, so UI visibility matches the server gate.
3. Update the matching `requirePortalCaller(...)` predicate on every affected
   `src/app/api/**` route.
4. Update this matrix, [permissions.md](./permissions.md), and add/adjust a test in
   `src/lib/__tests__/` (predicate test + a permission-denied route test).
