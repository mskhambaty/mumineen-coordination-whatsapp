# Anjuman e Saifee WhatsApp Assistant

WhatsApp-only Next.js backend for Anjuman e Saifee Chicago Ashara Mubarak 1447H coordination.

The app receives Meta WhatsApp Cloud API webhooks, stores users/messages/sessions in Supabase, runs an OpenAI assistant with permissioned tools, and replies through the Meta Graph API.

## Runtime Environment

Set these in Vercel project environment variables for Production and Preview:

```text
META_GRAPH_API_VERSION
META_WEBHOOK_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
OPENAI_MODEL
```

Optional:

```text
META_APP_SECRET
```

The runtime prefers the uppercase names above, but it also accepts the mixed-case names already visible in the Vercel dashboard, such as `Whatsapp_access_token`, `Whatsapp_phone_number_id`, `OpenAI_key`, and `Supabase_project_url`.

If `META_APP_SECRET` is set, webhook `POST` requests must include a valid `X-Hub-Signature-256` header.

Do not put runtime service tokens in GitHub secrets unless GitHub Actions needs them. GitHub Copilot/MCP should only need `COPILOT_MCP_SUPABASE_ACCESS_TOKEN`.

## Webhook

The Meta callback URL is:

```text
https://<your-vercel-domain>/api/whatsapp/webhook
```

Use the same value for `META_WEBHOOK_VERIFY_TOKEN` in Vercel and in Meta's webhook configuration.

Implemented routes:

```text
GET  /api/whatsapp/webhook
POST /api/whatsapp/webhook
```

`GET` validates Meta's webhook challenge. `POST` parses inbound WhatsApp messages, ignores non-message events, prevents duplicate processing by `whatsapp_message_id`, stores inbound/outbound messages, runs the assistant, and sends a WhatsApp reply.

## Supabase

Apply the migration:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

The first migration creates:

```text
whatsapp_users
messages
conversation_sessions
committee_permissions
tool_audit_logs
```

RLS is enabled on all tables. The server uses `SUPABASE_SERVICE_ROLE_KEY`, which must only live in server runtime environments like Vercel environment variables.

To mark a number as committee:

```sql
update public.whatsapp_users
set role = 'committee'
where phone_e164 = '+13125551212';
```

## Meta WhatsApp Setup

Subscribe the app to the WABA:

```http
POST https://graph.facebook.com/{META_GRAPH_API_VERSION}/{WABA_ID}/subscribed_apps
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
```

Get phone numbers:

```http
GET https://graph.facebook.com/{META_GRAPH_API_VERSION}/{WABA_ID}/phone_numbers
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
```

Register the phone number:

```http
POST https://graph.facebook.com/{META_GRAPH_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/register
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "pin": "123456"
}
```

Send the `hello_world` template test:

```http
POST https://graph.facebook.com/{META_GRAPH_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "{RECIPIENT_PHONE_E164}",
  "type": "template",
  "template": {
    "name": "hello_world",
    "language": {
      "code": "en_US"
    }
  }
}
```

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Verify the webhook challenge locally:

```bash
curl "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$META_WEBHOOK_VERIFY_TOKEN&hub.challenge=test-challenge"
```

## Testing

```bash
npm run lint
npm run test
npm run build
```

## Initial Tool Behavior

The tool layer is wired for:

```text
Public:
get_event_schedule
get_parking_info
get_directions
get_faq_answer
get_lost_found_info

Committee:
get_volunteer_assignment
lookup_committee_contact
update_volunteer_status
create_internal_note
```

The current implementations intentionally do not invent live operational details. They return "not published" or "not connected" placeholders until real schedule, parking, volunteer, and contact data sources are added.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
