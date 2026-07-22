import { getSupabaseAdmin } from "@/lib/supabase/server";

// Raw capture of inbound WhatsApp interactive responses (Flow nfm_reply completions and button
// taps). Phase 1 only STORES the response so it isn't lost; decoding it into a niyaz RSVP is phase 2.
// Stores opaque ids/tokens + the raw payload only — never logs PII.

export type InteractiveResponseInput = {
  phoneE164: string;
  waMessageId?: string | null;
  type: "flow" | "button";
  // Self-describing token we minted at send time (e.g. "rsvp:<muminId>:<instanceId>" or the
  // quick-reply payload string), stored verbatim for the phase-2 decode.
  flowToken?: string | null;
  // The Flow's parsed response_json, or the quick-reply payload wrapped as an object.
  payload: unknown;
};

export async function recordInteractiveResponse(input: InteractiveResponseInput): Promise<void> {
  await getSupabaseAdmin().from("whatsapp_interactive_responses").insert({
    phone_e164: input.phoneE164,
    wa_message_id: input.waMessageId ?? null,
    response_type: input.type,
    flow_token: input.flowToken ?? null,
    payload: input.payload ?? null,
  });
}
