import { optionalEnv } from "@/lib/env";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin, recordOutboundMessage } from "@/lib/supabase/server";

export type SendMode = "button" | "text" | "text_plain";

export type Recipient = { phone: string; muminId: string | null; familyId: string; displayName: string | null };

type NiyazInstance = {
  id: string;
  title: string;
  event_at: string | null;
  venue_name: string | null;
  status: string;
};

function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : input;
}

function looksLikePhone(input: string): boolean {
  return /^\+/.test(input.trim()) || input.replace(/\D/g, "").length >= 10;
}

// Resolve an ITS or phone number to a reachable recipient tied to a roster family.
export async function resolveRecipient(itsOrPhone: string): Promise<Recipient> {
  const supabase = getSupabaseAdmin();
  const input = itsOrPhone.trim();

  if (looksLikePhone(input)) {
    const phone = normalizePhone(input);
    const { data: link } = await supabase
      .from("mumin_phone_links")
      .select("mumin_id")
      .eq("phone_e164", phone)
      .limit(1)
      .maybeSingle();
    if (!link?.mumin_id) throw new Error(`No registered family is linked to ${phone}.`);
    const { data: mumin } = await supabase
      .from("mumineen")
      .select("hof_its, full_name")
      .eq("id", link.mumin_id)
      .maybeSingle();
    if (!mumin?.hof_its) throw new Error(`No family found for ${phone}.`);
    const familyId = await familyIdForHof(mumin.hof_its);
    if (!familyId) throw new Error(`No family found for ${phone}.`);
    return { phone, muminId: link.mumin_id, familyId, displayName: mumin.full_name };
  }

  // Treat as an ITS.
  const { data: mumin } = await supabase
    .from("mumineen")
    .select("id, hof_its, whatsapp_e164, full_name")
    .eq("its", input)
    .eq("roster_active", true)
    .maybeSingle();
  if (!mumin) throw new Error(`No roster member found for ITS ${input}.`);
  if (!mumin.whatsapp_e164) throw new Error(`ITS ${input} has no WhatsApp number on file.`);
  const familyId = mumin.hof_its ? await familyIdForHof(mumin.hof_its) : null;
  if (!familyId) throw new Error(`No family found for ITS ${input}.`);
  return { phone: normalizePhone(mumin.whatsapp_e164), muminId: mumin.id, familyId, displayName: mumin.full_name };
}

async function familyIdForHof(hofIts: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin().from("families").select("id").eq("hof_its", hofIts).eq("roster_active", true).maybeSingle();
  return data?.id ?? null;
}

function fmtEvent(iso: string | null): string {
  if (!iso) return "the event";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the event";
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function plainBody(instance: NiyazInstance): string {
  const when = fmtEvent(instance.event_at);
  const where = instance.venue_name ? ` at ${instance.venue_name}` : "";
  return (
    `Salaam. RSVP for ${instance.title} (${when}${where}).\n\n` +
    `Please reply YES or NO. If yes, include how many will attend — e.g. "Yes 4". Jazakallahu khairan.`
  );
}

// Send an RSVP prompt to one recipient and open a tracking row so the reply can be auto-captured.
export async function sendRsvpPrompt(opts: { instance: NiyazInstance; recipient: Recipient; mode: SendMode }): Promise<{ promptId: string; waMessageId: string | undefined }> {
  const { instance, recipient, mode } = opts;
  const bodyParams = [instance.title, fmtEvent(instance.event_at), instance.venue_name ?? "—"];

  let waMessageId: string | undefined;
  let rawPayload: unknown;
  let loggedBody: string;

  if (mode === "button") {
    const name = optionalEnv("NIYAZ_RSVP_BUTTON_TEMPLATE");
    if (!name) throw new Error("Button template is not configured yet (set NIYAZ_RSVP_BUTTON_TEMPLATE).");
    const res = await sendWhatsAppTemplate(recipient.phone, name, bodyParams);
    waMessageId = res.messages?.[0]?.id;
    rawPayload = res;
    loggedBody = `[template:${name}] ${bodyParams.join(" | ")}`;
  } else if (mode === "text") {
    const name = optionalEnv("NIYAZ_RSVP_TEXT_TEMPLATE");
    if (!name) throw new Error("Free-text template is not configured yet (set NIYAZ_RSVP_TEXT_TEMPLATE).");
    const res = await sendWhatsAppTemplate(recipient.phone, name, bodyParams);
    waMessageId = res.messages?.[0]?.id;
    rawPayload = res;
    loggedBody = `[template:${name}] ${bodyParams.join(" | ")}`;
  } else {
    const body = plainBody(instance);
    const res = await sendWhatsAppText(recipient.phone, body);
    waMessageId = res.messages?.[0]?.id;
    rawPayload = res;
    loggedBody = body;
  }

  const supabase = getSupabaseAdmin();

  // Only the newest prompt to a phone is "live" — retire any earlier active ones.
  await supabase
    .from("rsvp_prompts")
    .update({ stage: "done" })
    .eq("phone_e164", recipient.phone)
    .in("stage", ["sent", "awaiting_head_count"]);

  const { data: prompt, error } = await supabase
    .from("rsvp_prompts")
    .insert({
      registration_instance_id: instance.id,
      family_id: recipient.familyId,
      mumin_id: recipient.muminId,
      phone_e164: recipient.phone,
      mode,
      wa_message_id: waMessageId,
      stage: "sent",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await recordOutboundMessage({
    phoneE164: recipient.phone,
    body: loggedBody,
    whatsappMessageId: waMessageId,
    rawPayload: { source: "niyaz_rsvp_prompt", mode, instance_id: instance.id, meta_response: rawPayload },
  });

  return { promptId: prompt.id, waMessageId };
}
