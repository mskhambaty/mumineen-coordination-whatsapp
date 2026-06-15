import { NextRequest } from "next/server";

import { webhookReceive, webhookVerify } from "@/lib/whatsapp/inbound";

export const runtime = "nodejs";
// The reply is generated in an after() background task that runs up to two sequential model
// completions. Reasoning models (GPT-5.x) are much slower than gpt-4o-mini, so without an
// explicit cap the background work was being killed by the default timeout before it could send
// — the webhook returned 200, no error was thrown, and the user got total silence. Match the
// generous cap used by the other heavy routes so the agent always has time to finish and reply.
export const maxDuration = 300;

// Single shared inbound webhook for ALL WhatsApp numbers. Every Meta App points its callback URL
// here; the shared handlers in src/lib/whatsapp/inbound.ts resolve which account a delivery belongs
// to from its metadata.phone_number_id, verify with that account's app secret, and reply from that
// number. Adding another number is env-only — no new route or callback URL.
export function GET(req: NextRequest) {
  return webhookVerify(req);
}

export function POST(req: NextRequest) {
  return webhookReceive(req);
}
