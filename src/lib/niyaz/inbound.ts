import { sendWhatsAppText } from "@/lib/meta/whatsapp";
import { recordRsvpResponse, type RsvpResponseValue } from "@/lib/niyaz/record";
import { getSupabaseAdmin, recordOutboundMessage, touchConversationSession } from "@/lib/supabase/server";
import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/parser";

type Prompt = {
  id: string;
  registration_instance_id: string;
  family_id: string;
  mumin_id: string | null;
  stage: "sent" | "awaiting_head_count" | "done";
  pending_response: RsvpResponseValue | null;
};

// Interpret a yes/no/maybe answer from free text or a tapped quick-reply button title.
function parseResponse(body: string): RsvpResponseValue | null {
  const t = body.trim().toLowerCase();
  if (/^(y|yes|haan|ha|attending|coming)\b/.test(t) || t === "yes") return "yes";
  if (/^(n|no|nahi|not)\b/.test(t)) return "no";
  if (/\b(maybe|insha|inshallah|not sure)\b/.test(t)) return "maybe";
  return null;
}

function parseCount(body: string): number | null {
  const m = body.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function reply(phone: string, text: string, userId: string | undefined) {
  const res = await sendWhatsAppText(phone, text);
  await recordOutboundMessage({
    phoneE164: phone,
    body: text,
    whatsappMessageId: res.messages?.[0]?.id,
    rawPayload: { source: "niyaz_rsvp_capture", meta_response: res },
  });
  await touchConversationSession({ phoneE164: phone, userId });
}

async function setStage(id: string, patch: Record<string, unknown>) {
  await getSupabaseAdmin().from("rsvp_prompts").update(patch).eq("id", id);
}

// If this inbound is answering an outstanding RSVP prompt, capture it and return true (so the
// caller skips the normal agent flow). Otherwise return false. Covers both the button-tap path
// (body = "Yes") and the free-text path ("yes", "yes 4", "4").
export async function maybeHandleRsvpReply(message: IncomingWhatsAppMessage, userId: string | undefined): Promise<boolean> {
  const body = message.body?.trim();
  if (!body) return false;

  const supabase = getSupabaseAdmin();

  // Latest live prompt for this phone whose instance is still open.
  const { data: prompts } = await supabase
    .from("rsvp_prompts")
    .select("id, registration_instance_id, family_id, mumin_id, stage, pending_response, rsvp_registration_instance!inner(status, closes_at)")
    .eq("phone_e164", message.phoneE164)
    .in("stage", ["sent", "awaiting_head_count"])
    .eq("rsvp_registration_instance.status", "open")
    .order("sent_at", { ascending: false })
    .limit(1);

  const row = (prompts?.[0] ?? null) as (Prompt & { rsvp_registration_instance?: { closes_at: string | null } }) | null;
  if (!row) return false;

  // Respect the RSVP close time if set.
  const closesAt = row.rsvp_registration_instance?.closes_at;
  if (closesAt && new Date(closesAt).getTime() < Date.now()) return false;

  const record = async (response: RsvpResponseValue, headCount: number | null) => {
    await recordRsvpResponse({
      instanceId: row.registration_instance_id,
      familyId: row.family_id,
      muminId: row.mumin_id,
      response,
      headCount,
      source: "whatsapp",
      phone: message.phoneE164,
    });
    await setStage(row.id, { stage: "done", pending_response: response, responded_at: new Date().toISOString() });
  };

  if (row.stage === "awaiting_head_count") {
    const count = parseCount(body);
    if (count === null) {
      await reply(message.phoneE164, "Sorry, how many will attend? Please reply with a number, e.g. 4.", userId);
      return true;
    }
    await record("yes", count);
    await reply(message.phoneE164, `Shukran — noted ${count} attending. Jazakallahu khairan.`, userId);
    return true;
  }

  // stage === "sent": expect yes/no/maybe (optionally with a count).
  const response = parseResponse(body);
  if (!response) {
    await reply(message.phoneE164, "Please reply YES or NO to the RSVP. If yes, include how many will attend (e.g. \"Yes 4\").", userId);
    return true;
  }

  if (response === "yes") {
    const count = parseCount(body);
    if (count !== null) {
      await record("yes", count);
      await reply(message.phoneE164, `Shukran — noted ${count} attending. Jazakallahu khairan.`, userId);
      return true;
    }
    await setStage(row.id, { stage: "awaiting_head_count", pending_response: "yes" });
    await reply(message.phoneE164, "Jee — how many from your family will attend? Please reply with a number.", userId);
    return true;
  }

  // no / maybe
  await record(response, 0);
  await reply(message.phoneE164, response === "no" ? "Noted — you won't be attending. Shukran for letting us know." : "Noted as a maybe. Shukran.", userId);
  return true;
}
