import { after } from "next/server";

import { runAgent } from "@/lib/agent/run-agent";
import { resolveCallerFromPhone } from "@/lib/api/auth";
import { getRegistrationStatus, isRegistrationGateEnabled } from "@/lib/mumineen/registration";
import type { AppUser } from "@/lib/permissions";
import { recordFamilyHeadCount, recordUnregisteredHeadCount, type ClampNotice } from "@/lib/rsvp/meal-rsvp";
import { consumePrompt, findOpenPrompt } from "@/lib/rsvp/niyaz-prompt";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { insertPendingMessage, runCoalescedInbound } from "@/lib/whatsapp/coalesce";

// Channel-neutral handling of one inbound TEXT message, shared by the WhatsApp inbound path and the
// in-app agent chat so the two can't drift. The caller records the inbound message and touches the
// session first; this runs the same steps the webhook always ran: Niyaz head-count reply → manual
// mode (agent paused) → registration gate → coalesced agent run. The only per-channel piece is
// `deliver`, which sends/records a reply (WhatsApp: Meta + record; in-app: record only).

export const REGISTER_URL = "https://www.chicagorelaycenter.com/register";

// Send/record one reply. `rawPayloadExtra` tags non-agent replies (e.g. { source: "registration_gate" }).
export type ReplyDelivery = (text: string, rawPayloadExtra?: Record<string, unknown>) => Promise<void>;

export async function handleInboundText(input: {
  user: AppUser;
  phoneE164: string;
  body: string;
  messageId: string;
  inboundId: string | null;
  deliver: ReplyDelivery;
  // When set, called after the gates INSTEAD of the agent (WhatsApp image messages).
  replyInsteadOfAgent?: () => Promise<void>;
  // In-app "visitor mode": the agent treats a portal user as a visitor (narrows access only).
  visitorMode?: boolean;
}): Promise<void> {
  const { phoneE164, body } = input;

  // Free-text family head-count reply: if there's an open RSVP prompt for this number and the message
  // contains a number, record the family head count for that prompt's date and confirm.
  if (body.trim() && /\d/.test(body) && (await handleNiyazHeadCount(phoneE164, body, input.deliver))) {
    return;
  }

  const { data: session } = await getSupabaseAdmin()
    .from("conversation_sessions")
    .select("handling_mode")
    .eq("phone_e164", phoneE164)
    .maybeSingle();

  if (session?.handling_mode === "manual") {
    return;
  }

  // Registration gate (off by default): unregistered, non-internal users get a nudge to
  // register instead of agent service. Internal users (committee/admin/support) bypass.
  if (await isRegistrationGateEnabled()) {
    const { registered } = await getRegistrationStatus(phoneE164);
    if (!registered) {
      const internal = await resolveCallerFromPhone(phoneE164).then(() => true).catch(() => false);
      if (!internal) {
        await input.deliver(
          "Salaam. This number isn't registered for Ashara Mubaraka 1448H (Chicago) yet, so I can't assist over chat. " +
            `Please complete your family's registration here: ${REGISTER_URL} — then message us again and we'll be glad to help.`,
          { source: "registration_gate" },
        );
        return;
      }
    }
  }

  if (input.replyInsteadOfAgent) {
    await input.replyInsteadOfAgent();
    return;
  }

  if (!body.trim()) {
    return;
  }

  // Queue the text message for coalesced processing instead of responding immediately.
  const lockKey = phoneE164;

  await insertPendingMessage({
    lockKey,
    phoneE164,
    messageId: input.messageId,
    body,
    inboundMsgId: input.inboundId,
  });

  const agentUser: AppUser = input.visitorMode ? { ...input.user, role: "visitor" } : input.user;

  after(() =>
    runCoalescedInbound<string>({
      lockKey,
      process: async (combinedText) => {
        return runAgent({
          user: agentUser,
          phoneE164,
          message: combinedText,
          visitorMode: input.visitorMode,
        });
      },
      send: async (reply) => {
        const cleaned = reply.replace(/\[\[\s*no[_\s]?reply\s*\]\]/gi, "").trim();
        if (isSilentReply(cleaned)) {
          return;
        }
        await input.deliver(cleaned);
      },
    }),
  );
}

// Record a free-text head-count reply against the caller's most recent open prompt. Returns false
// (so the message flows to the agent) when there's no open prompt or no number in the message.
async function handleNiyazHeadCount(phoneE164: string, body: string, deliver: ReplyDelivery): Promise<boolean> {
  const prompt = await findOpenPrompt(phoneE164);
  if (!prompt) return false;
  const m = body.match(/\d{1,3}/);
  if (!m) return false;
  const count = Math.min(999, parseInt(m[0], 10));

  const isUnregistered = !prompt.family_id;
  let clamped: ClampNotice | undefined;
  if (prompt.family_id) {
    // Head count is materialized into niyaz_rsvp (allocated across family members). If it exceeds
    // the family's roster, the result is clamped to the actual member count.
    const result = await recordFamilyHeadCount(prompt.family_id, prompt.event_date, count, phoneE164);
    clamped = result.clamped;
  } else {
    await recordUnregisteredHeadCount(phoneE164, prompt.event_date, count);
  }
  await consumePrompt(prompt.id);

  const day = new Date(`${prompt.event_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const recorded = clamped ? clamped.maxTotal : count;
  let reply = `Shukran! Recorded ${recorded} from your family attending for ${day}. Reply with a new number if it changes.`;
  if (clamped) {
    reply += `\n\nThat's more than your registered family size, so we recorded ${clamped.maxTotal}. Anyone extra should message us from their own phone and register at ${REGISTER_URL}.`;
  }
  if (isUnregistered) {
    reply += `\n\nPlease register your family at ${REGISTER_URL} so we can link your records automatically.`;
  }
  await deliver(reply, { source: "niyaz_rsvp_headcount", event_date: prompt.event_date, head_count: count });
  return true;
}

function isSilentReply(reply: string): boolean {
  const trimmed = reply.trim();
  if (!trimmed) return true;
  return trimmed.replace(/[^a-z]/gi, "").toUpperCase() === "NOREPLY";
}
