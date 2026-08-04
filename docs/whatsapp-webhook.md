# WhatsApp Webhook

> **Disabled.** The inbound webhook endpoint (`/api/whatsapp/webhook`) has been intentionally
> removed. `src/app/api/whatsapp/webhook/route.ts` no longer exists. Inbound WhatsApp messages
> are **not** processed by this application until the endpoint is reintroduced.  
> The underlying library code in `src/lib/whatsapp/inbound.ts` is preserved for future use.

## Overview (historical)

The webhook formerly lived at `/api/whatsapp/webhook` and handled all communication between the
Meta WhatsApp Cloud API and this application.

The route was a thin binding to the shared handlers in `src/lib/whatsapp/inbound.ts`
(`webhookVerify`, `webhookReceive`). All verification, parsing, account-routing, and processing
logic described below lived there. That one URL served **every** WhatsApp number.

### Multiple accounts (one shared URL)

Every WhatsApp number is served by this **single** callback URL — including a second number in its
own Meta App. There is no per-number route. On each POST, the handler reads
`metadata.phone_number_id` from the payload to resolve which **account** the delivery belongs to,
then:

- verifies the POST signature with **that account's** app secret (`META_APP_SECRET` for the primary,
  `META_APP_SECRET_BROADCAST` for the broadcast number),
- processes the message and sends every reply **from that account's number**,
- ignores (acks `200`) deliveries whose `phone_number_id` matches no configured account.

The `phone_number_id` is read from the not-yet-verified body, but it only *selects* which secret to
check — the HMAC signature check still authenticates the payload, so a forged number can't bypass
verification. The GET handshake accepts the challenge if `hub.verify_token` matches **any** configured
account's verify token (each Meta App sends its own during "Verify and Save").

**Adding another number is env-only:** configure its account (`accounts.ts` registry) and point its
Meta App's callback at this same URL — no new route or callback URL.

### Which number a conversation "lives" on

`conversation_sessions` has one row per `phone_e164` (upserted on conflict), so all of a person's
messages — across every business number — collapse into a single conversation/thread. The session's
`phone_number_id` records **where the conversation lives**, and **inbound messages are the authority**:
the latest inbound's number wins. **Outbound template/broadcast sends do NOT flip an existing
session's number** (`touchConversationSession({ phoneNumberIdOnlyIfNew: true })` in
`send-template.ts`) — they only tag the number for a brand-new (reply-less) recipient. This prevents a
niyaz blast from reclassifying a helpline conversation onto the broadcast number, which would
otherwise hide it from the scope-filtered inbox. (Migration
`20260616020000_backfill_flipped_broadcast_session_numbers` repaired sessions flipped before the fix.)

## GET — Webhook Verification

Meta calls this once when you register the callback URL.

```
GET /api/whatsapp/webhook
  ?hub.mode=subscribe
  &hub.verify_token=<META_WEBHOOK_VERIFY_TOKEN>
  &hub.challenge=<random-string>
```

- If `hub.mode === "subscribe"` and `hub.verify_token` matches `META_WEBHOOK_VERIFY_TOKEN`, returns the challenge as plain text with `200`.
- Otherwise returns `403 Forbidden`.

## POST — Inbound Messages

Meta sends a signed JSON payload for every inbound event.

### Signature Verification

If `META_APP_SECRET` is set, the handler verifies the `X-Hub-Signature-256` header using HMAC-SHA256.  
Source: `src/lib/meta/whatsapp.ts → verifyMetaSignature()`

If the secret is not set, verification is skipped (useful for local dev).

### Payload Parsing

`extractIncomingMessages()` (`src/lib/whatsapp/parser.ts`) extracts a typed `IncomingWhatsAppMessage` from the raw webhook payload.

Supported message types:
- `text` — `message.text.body`
- `button` — `message.button.text`
- `interactive` — `button_reply.title` or `list_reply.title`

It also surfaces:
- `buttonPayload` — the quick-reply payload (template `quick_reply`) or interactive reply id.
- `flowResponse` — for a WhatsApp **Flow** completion (`interactive.nfm_reply`): the parsed
  `response_json` and the echoed `flow_token` (e.g. `rsvp:<muminId>:<instanceId>`).

All other types produce an empty `body` string; the agent handles empty bodies gracefully.

### Niyaz double-RSVP interactive responses (raw capture — phase 1)

The `ashara_relay_double_rsvp` template sends a **Flow** button ("Attending") and an
`rsvp:<hof_its>:<registration_instance_id>:not-attending` quick-reply (the button payload mirrors the
Flow token's `rsvp:`-prefixed shape). When either response arrives, the webhook records it raw via
`recordInteractiveResponse()` into `whatsapp_interactive_responses` (response_type `flow` | `button`,
the `flow_token`/payload stored verbatim) and **returns early** (not routed to the agent). It then
**decodes** the response into `niyaz_rsvp` (phase 2, best-effort — the raw row is kept regardless):
`hof_its` → family, `registration_instance_id` → the day's `niyaz_event_config.day_id`, and the
lunch/dinner counts are written per meal instance (real members allocated head→adults→kids; overflow
beyond the roster recorded as **guest** rows — see `recordNiyazDayRsvp` / `recordNiyazRsvpFromInteractive`
in `src/lib/rsvp/`). Re-submissions reconcile (idempotent on `(instance, mumin)`). After recording,
`sendNiyazConfirmation` sends the day's confirmation template back to the responder (best-effort).
This branch runs ahead of the legacy `niyaz|level|scope|date` quick-reply handler (`handleNiyazButton`),
which still records its taps directly. Source: `src/lib/whatsapp/interactive-responses.ts`.

### Processing Pipeline

For each extracted message:

1. **Deduplication** — `recordInboundMessage()` inserts into `messages` with a unique constraint on `whatsapp_message_id`. If the row already exists (Postgres error `23505`), the message is skipped.
2. **User upsert** — `getOrCreateWhatsappUser()` finds or creates a `whatsapp_users` row with `role = 'visitor'` by default.
3. **Session touch** — `touchConversationSession()` upserts `conversation_sessions`, updating `last_message_at`.
4. **Guard checks** — reactions, manual-mode sessions, and images are handled immediately (not coalesced). Empty-body messages (unsupported types) return silently.
5. **Queue** — `insertPendingMessage()` inserts the text into `whatsapp_pending_messages`.
6. **Deferred coalescing** — `after(() => runCoalescedInbound(...))` acquires a Postgres lease lock for the conversation. If another runner already holds the lock, this invocation returns immediately (its message is already in the queue and the other runner will drain it). The winning runner debounces (2.5s), then drains the queue in a loop: each pass calls `runAgent()` on the batch, and only the final reply is sent.
7. **Send reply** — `sendWhatsAppText()` calls the Meta Graph API (final reply only).
8. **Outbound record** — `recordOutboundMessage()` saves the reply in `messages`.
9. **Session touch** — called again to capture the post-reply timestamp.

The route always returns `200` to Meta, even on per-message errors, to avoid Meta retrying indefinitely.

### Message Coalescing

Users often send 2-3 WhatsApp messages in quick succession (greeting + question, or a thought split across texts). Without coalescing, each message would trigger its own independent OpenAI call and reply, leading to duplicate greetings, redundant responses, and a confusing experience.

The coalescing engine (`src/lib/whatsapp/coalesce.ts`) solves this with a Postgres-backed lease lock + pending queue pattern. On Vercel each webhook POST can land on a different lambda instance, so the lock and queue must live in Postgres (not in-process memory).

Source: `src/lib/whatsapp/coalesce.ts`  
Tables: `whatsapp_inbound_locks`, `whatsapp_pending_messages`

Tuning knobs (env vars):
- `WA_COALESCE_DEBOUNCE_MS` — debounce wait before first drain (default 2500ms, set 0 to disable)
- Lock TTL is 180s; max drain passes is 6.

## Meta Setup

Register the callback URL in the Meta app dashboard:

```
https://<your-vercel-domain>/api/whatsapp/webhook
```

Subscribe the app to the WABA:

```http
POST https://graph.facebook.com/{META_GRAPH_API_VERSION}/{WABA_ID}/subscribed_apps
Authorization: ******
```

For the **second number**, repeat the subscription in its own Meta App, but point its callback at the
**same** URL (`/api/whatsapp/webhook`) with its own verify token (`META_WEBHOOK_VERIFY_TOKEN_BROADCAST`).
No separate route is needed — the handler routes by `metadata.phone_number_id`.

## Local Testing

```bash
# Verify webhook challenge
curl "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$META_WEBHOOK_VERIFY_TOKEN&hub.challenge=test-challenge"
```

Use [ngrok](https://ngrok.com/) or similar to expose `localhost:3000` and point the Meta webhook there.
