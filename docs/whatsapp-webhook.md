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
4. **Agent run** — `runAgent()` produces a reply string.
5. **Send reply** — `sendWhatsAppText()` calls the Meta Graph API.
6. **Outbound record** — `recordOutboundMessage()` saves the reply in `messages`.
7. **Session touch** — called again to capture the post-reply timestamp.

The route always returns `200` to Meta, even on per-message errors, to avoid Meta retrying indefinitely.

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
