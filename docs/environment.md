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
| `NEXT_PUBLIC_APP_URL` | `App_url`, `APP_URL` | Public app base URL, e.g. Vercel production URL |
| `POSTMARK_API_TOKEN` | `Postmark_api_token` | Postmark server API token; rotate if exposed |
| `POSTMARK_FROM_EMAIL` | `Postmark_from_email` | Verified Postmark sender address |
| `POSTMARK_PASSWORD_RESET_TEMPLATE` | `Postmark_password_reset_template` | Postmark template alias for password reset |
| `POSTMARK_TASK_NOTIFICATION_TEMPLATE` | `Postmark_task_notification_template` | Postmark template alias for task digest |

## Optional Variables

| Name | Accepted Aliases | Default | Notes |
|------|-----------------|---------|-------|
| `META_APP_SECRET` | `Meta_app_secret` | (unset) | If set, validates `X-Hub-Signature-256` on webhook POSTs. Strongly recommended in production. |
| `META_GRAPH_API_VERSION` | `Meta_graph_api_version` | `v23.0` | Meta Graph API version used for sending messages. |
| `OPENAI_MODEL` | `OpenAI_model` | `gpt-4o-mini` | Override the centralized chat completion model in `src/lib/ai/model.ts`. |

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
