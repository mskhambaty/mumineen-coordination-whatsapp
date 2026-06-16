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
| `LISAN_ALERT_EMAIL` | — | **Additional** recipient for Lisan missing-word / word-added alerts, on top of the religious-monitor team (managed on Waaz Talaqqi → Team). Optional — unset means only the monitors are emailed; if there are also no monitors, the word is still queued in `lisan_word_requests` but no email is sent. |
| `POSTMARK_PASSWORD_RESET_TEMPLATE` | `Postmark_password_reset_template` | Postmark template alias for password reset (default `password-reset`) |
| `POSTMARK_WELCOME_ADMIN_TEMPLATE` | `Postmark_welcome_admin_template` | Postmark template alias for new portal user welcome invites (default `welcome-admin-email`) |
| `POSTMARK_ASSIGNMENT_TEMPLATE` | `Postmark_assignment_template` | Postmark template alias for assignment and department issue-contact alerts (default `assignment-notification`) |
| `POSTMARK_ESCALATION_REQUEST_TEMPLATE` | `Postmark_escalation_request_template` | Postmark template alias for escalation alerts (default `escalation-request`) |

## Optional Variables

| Name | Accepted Aliases | Default | Notes |
|------|-----------------|---------|-------|
| `META_APP_SECRET` | `Meta_app_secret` | (unset) | If set, validates `X-Hub-Signature-256` on webhook POSTs. Strongly recommended in production. |
| `META_GRAPH_API_VERSION` | `Meta_graph_api_version` | `v23.0` | Meta Graph API version used for sending messages. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `Whatsapp_template_language` | `en_US` | Fallback language code for approved Meta WhatsApp utility templates. Template notifications now resolve the live template (incl. its real language) from Meta, so this is only a fallback. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `Whatsapp_business_account_id` | (unset) | WhatsApp Business Account ID. **Required for every template notification** (welcome `committee_platform_access_created`, issue `department_ticket_assigned`, escalation `escalation_ticket_assigned`) — `listMessageTemplates()` reads it to resolve the approved template. Without it, template sends fail gracefully and only the email channel goes out. |
| `WHATSAPP_UTILITY_MSG_COST_USD` | — | `0.0` | Estimated per-message cost (USD) of a paid (out-of-window) utility template send (~$4 per 1000 delivered = `0.004`). Display-only — used by the admin Send Templates console to estimate broadcast cost. Not billed or enforced. |
| `DIGEST_WHATSAPP_ENABLED` | — | `false` | Set to `true` to enable WhatsApp sends in the nightly department digest. Controls Meta template quota usage. |
| `SURVEY_SEND_ENABLED` | — | `false` | Set to `true` to enable WhatsApp dispatch of targeted feedback-survey links. When off, the survey is committed (tokens + exposures) and per-recipient links are returned for manual sending — so the feature never blocks on Meta template approval. |
| `SURVEY_WA_TEMPLATE` | — | — | Approved WhatsApp URL-button template used to send survey links; the dynamic URL suffix `{{1}}` is the per-recipient token, body `{{1}}` is the first name. Required when `SURVEY_SEND_ENABLED=true`. |
| `WHATSAPP_WINDOW_HOURS` | — | `24` | **Default** hours of the WhatsApp customer-service window treated as "free" (in-window) when the Send Templates console splits an audience free/paid and applies the conversation-window filter. The console can override this per action via its **Window (hours)** input (any positive value). Meta's billing window is 24h; set this **below** 24 for a conservative safety margin (e.g. `14` → anyone who hasn't messaged in 14h counts as paid even if technically still free). Non-positive / unparseable values fall back to `24`. |
| `DEPARTMENT_SUMMARY_WA_TEMPLATE` | — | `daily_department_issue_confirmation` | Approved Meta template for the nightly department digest WhatsApp message. Two body vars: `{{1}}` department name, `{{2}}` short summary. |
| `POSTMARK_DEPARTMENT_SUMMARY_TEMPLATE` | — | `daily-department-summary` | Postmark template alias for the nightly department digest email. Model: `department_name`, `feedback_html`, `feedback_text`. |
| `OPENAI_MODEL` | `OpenAI_model` | `gpt-4o-mini` | Override the centralized chat completion model in `src/lib/ai/model.ts`. Any model id valid for the Chat Completions API works, including GPT-5.x (e.g. `gpt-5.4-mini`) — `chatParams()` adapts the request shape automatically (see note below). |
| `OPENAI_MODEL_HIGH` | — | falls back to `OPENAI_MODEL` | Higher-end model for Waaz Talaqi / Lisan answers AND the nightly digest conversation-mining batch (e.g. `gpt-5.4`). Falls back to `OPENAI_MODEL` when unset or on error. **Must be a genuine OpenAI Chat Completions model.** If you ever see replies containing leaked tool-call text (`to=functions.…`), harmony markers, or non-Latin junk tokens (e.g. CJK), this var (or `OPENAI_BASE_URL`) is pointed at a non-OpenAI / open-weights endpoint — fix it or unset this var (falls back to the stable `OPENAI_MODEL`). `sanitizeFinalReply` in `run-agent.ts` is only a backstop, not a cure. |
| `SESSION_SECRET` | — | falls back to `ADMIN_API_KEY` | Signs portal session cookies (HMAC-SHA256). Set a dedicated random value in production to isolate cookie signing from the server-to-server API key. |
| `ISTIBSAAR_ONCALL_URL` | — | `https://www.talabulilm.com/istibsaar/oncall` | Link the agent suggests for deeper guidance when it can't answer a deen question or after a few religious back-and-forths. Override only if the on-call URL changes. |

## Multiple WhatsApp numbers (accounts)

The app can serve more than one WhatsApp number — e.g. a higher-tier **broadcast** number for sending
templates. Each number is a separate "account": its own phone number id, access token, WABA, Meta App
secret, and webhook verify token. The registry lives in [`src/lib/whatsapp/accounts.ts`](../src/lib/whatsapp/accounts.ts).

- The **primary** account is the existing unsuffixed configuration (`WHATSAPP_PHONE_NUMBER_ID`, …).
- A **broadcast** account is configured with the suffixed `*_BROADCAST` variables below. If
  `WHATSAPP_PHONE_NUMBER_ID_BROADCAST` is unset, only the primary account exists and behavior is
  unchanged.

Because the two numbers live under separate Meta Apps, each has its **own** app secret and webhook
verify token. All Meta Apps point at the **same** callback URL (`/api/whatsapp/webhook`); the handler
routes each delivery to the right account by `metadata.phone_number_id` (see
[`whatsapp-webhook.md`](./whatsapp-webhook.md)), so adding a number never adds a route. A template
lives in exactly one WABA, so the chosen template determines which number a broadcast/send goes out
from; replies are always sent from the number the message arrived on.

| Name | Accepted Aliases | Default | Notes |
|------|-----------------|---------|-------|
| `WHATSAPP_PHONE_NUMBER_ID_BROADCAST` | `Whatsapp_phone_number_id_broadcast` | (unset) | Phone number id of the second number. Presence of this var is what enables the broadcast account. |
| `WHATSAPP_ACCESS_TOKEN_BROADCAST` | `Whatsapp_access_token_broadcast` | (unset) | Access token for the second number's Meta App. Required when the broadcast account is enabled. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST` | `Whatsapp_business_account_id_broadcast` | (unset) | WABA id that owns the second number's templates. |
| `META_APP_SECRET_BROADCAST` | `Meta_app_secret_broadcast` | (unset) | App secret of the second Meta App; validates `X-Hub-Signature-256` on the broadcast webhook route. |
| `META_WEBHOOK_VERIFY_TOKEN_BROADCAST` | `Meta_webhook_verify_token_broadcast` | (unset) | Verify token for the second Meta App's GET handshake. Its webhook points at the shared `/api/whatsapp/webhook` URL (the handshake accepts any account's token). |
| `WHATSAPP_DISPLAY_PHONE_NUMBER_BROADCAST` | `Whatsapp_display_phone_number_broadcast` | (unset) | Optional display number for labeling / inbound allow-checks. |

> **Model compatibility (GPT-5.x / o-series).** These are reasoning models: they reject a custom
> `temperature` and the deprecated `max_tokens`, requiring `max_completion_tokens` instead. All
> chat calls go through `chatParams()` in [`src/lib/ai/model.ts`](../src/lib/ai/model.ts), which
> uses `max_completion_tokens` everywhere and only sends `temperature` to models that accept it.
> This keeps switching models a pure env-var change — never edit a call site to swap a model.

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
