# WhatsApp Webhook

## Overview

The webhook lives at `/api/whatsapp/webhook` and handles all communication between the Meta WhatsApp Cloud API and this application.  
Source: `src/app/api/whatsapp/webhook/route.ts`

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

All other types produce an empty `body` string; the agent handles empty bodies gracefully.

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

## Local Testing

```bash
# Verify webhook challenge
curl "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$META_WEBHOOK_VERIFY_TOKEN&hub.challenge=test-challenge"
```

Use [ngrok](https://ngrok.com/) or similar to expose `localhost:3000` and point the Meta webhook there.
