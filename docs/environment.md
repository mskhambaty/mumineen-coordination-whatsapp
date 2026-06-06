# Environment Variables

## Overview

All env var lookups go through `src/lib/env.ts`, which supports mixed-case alias names already present in the Vercel dashboard.

## Required Variables

| Canonical Name | Accepted Aliases | Where to get it |
|----------------|-----------------|-----------------|
| `META_WEBHOOK_VERIFY_TOKEN` | `Meta_webhook_verify_token` | Generate a strong random string; paste in both Vercel and Meta app dashboard |
| `WHATSAPP_ACCESS_TOKEN` | `Whatsapp_access_token` | Meta app dashboard → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | `Whatsapp_phone_number_id` | Meta app dashboard → WhatsApp → API Setup |
| `SUPABASE_URL` | `Supabase_url`, `Supabase_project_url` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `Supabase_service_role_key` | Supabase project → Settings → API (keep secret) |
| `OPENAI_API_KEY` | `OpenAI_key`, `OPENAI_key` | platform.openai.com |
| `CRON_SECRET` | — | Generate a strong random string; use in `Authorization: ****** |
| `NEXT_PUBLIC_APP_URL` | `App_url`, `APP_URL` | Public app base URL, `https://www.chicagorelaycenter.com` |
| `ADMIN_FALLBACK_PASSWORD` | `Admin_fallback_password` | Optional legacy login fallback for users without `password_hash`; set only in deployment secrets, never in repo |
| `ADMIN_API_KEY` | — | Server-to-server auth for agent tools and cron jobs. Never sent to the browser. Rotate after deploying the session-auth migration (see Security Notes). |
| `POSTMARK_API_TOKEN` | `Postmark_api_token` | Postmark server API token; rotate if exposed |
| `POSTMARK_FROM_EMAIL` | `Postmark_from_email` | Verified Postmark sender address |
| `POSTMARK_PASSWORD_RESET_TEMPLATE` | `Postmark_password_reset_template` | Postmark template alias for password reset (default `password-reset`) |
| `POSTMARK_WELCOME_ADMIN_TEMPLATE` | `Postmark_welcome_admin_template` | Postmark template alias for new portal user welcome invites (default `welcome-admin-email`) |
| `POSTMARK_TASK_NOTIFICATION_TEMPLATE` | `Postmark_task_notification_template` | Postmark template alias for task digest |
| `POSTMARK_ASSIGNMENT_TEMPLATE` | `Postmark_assignment_template` | Postmark template alias for assignment and department issue-contact alerts (default `assignment-notification`) |
| `POSTMARK_ESCALATION_REQUEST_TEMPLATE` | `Postmark_escalation_request_template` | Postmark template alias for escalation alerts (default `escalation-request`) |

## Optional Variables

| Name | Accepted Aliases | Default | Notes |
|------|-----------------|---------|-------|
| `META_APP_SECRET` | `Meta_app_secret` | (unset) | If set, validates `X-Hub-Signature-256` on webhook POSTs. Strongly recommended in production. |
| `META_GRAPH_API_VERSION` | `Meta_graph_api_version` | `v23.0` | Meta Graph API version used for sending messages. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `Whatsapp_template_language` | `en_US` | Language code for approved Meta WhatsApp utility templates such as `department_ticket_assigned`. |
| `OPENAI_MODEL` | `OpenAI_model` | `gpt-4o-mini` | Override the centralized chat completion model in `src/lib/ai/model.ts`. |
| `OPENAI_MODEL_HIGH` | — | falls back to `OPENAI_MODEL` | Higher-end model used **only** for Waaz Talaqi / Lisan answers (the final completion when `answer_religious_questions` or `get_lisan_word_meaning` was used). No-op until set. |
| `SESSION_SECRET` | — | falls back to `ADMIN_API_KEY` | Signs portal session cookies (HMAC-SHA256). Set a dedicated random value in production to isolate cookie signing from the server-to-server API key. |

## Local Development

```bash
cp .env.example .env.local
# Fill in values in .env.local
npm run dev
```

`.env.local` is git-ignored. Never commit secrets.

## Vercel Setup

Set all variables in the Vercel project under **Settings → Environment Variables** for both **Production** and **Preview** environments.

The code will find them by canonical or alias name — whichever you set.

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Keep it exclusively in server-side runtime environments (Vercel env vars).
- Do not put runtime service tokens in GitHub secrets unless a GitHub Actions workflow specifically needs them.
- `META_APP_SECRET` should always be set in production to prevent spoofed webhook requests.
- GitHub Copilot/MCP only needs `COPILOT_MCP_SUPABASE_ACCESS_TOKEN` — do not grant it access to service role keys.
- **After deploying the session-auth migration, rotate `ADMIN_API_KEY`**: the old value was exposed in historical client bundles as `NEXT_PUBLIC_ADMIN_KEY` and the server still accepts it for server-to-server calls. Update the Vercel env and any agent/cron consumers that send it in the `x-admin-key` header. **Set a dedicated `SESSION_SECRET` BEFORE rotating** — session cookies are signed with `SESSION_SECRET ?? ADMIN_API_KEY`, so rotating the key without a dedicated secret invalidates every live portal session (forces all users to re-login).
- `ADMIN_API_KEY` is now server-to-server only (agent tools, cron jobs). It must never be included in client-side code or sent to the browser.
