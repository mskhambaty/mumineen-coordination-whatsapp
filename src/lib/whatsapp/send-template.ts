import { listMessageTemplates, sendWhatsAppTemplateComponents } from "@/lib/meta/whatsapp";
import { recordOutboundMessage, touchConversationSession } from "@/lib/supabase/server";
import { buildSendComponents, describeTemplate, previewBody, type SendComponentInputs, type TemplateDescriptor } from "@/lib/whatsapp/templates";

// Single, standardized path for sending an approved Meta WhatsApp *template* as an
// outbound notification (welcome, issue assignment, escalation, …). Every flow goes
// through here so the resolve → validate → send → log pipeline stays uniform: each
// send is recorded as an outbound message and refreshes the conversation session,
// and failures are logged without ever leaking PII (phone numbers, bodies).
//
// A template (unlike a free-text send) delivers whether or not the recipient has an
// open 24h customer-service window — required for cold staff alerts (free-form sends
// to a window-less number return Meta error 131047).

export type TemplateSendResult = { status: "sent" | "failed"; error?: string; waMessageId?: string };

// Resolve an APPROVED template by name from the live Meta template list into the
// descriptor the send pipeline needs. Throws if the template is missing or not
// approved. Resolve once and pass the descriptor to sendTemplateNotification when
// fanning out to multiple recipients to avoid re-fetching the template list per send.
export async function resolveApprovedTemplate(templateName: string): Promise<TemplateDescriptor> {
  const templates = await listMessageTemplates();
  const raw = templates.find((t) => t.name === templateName && t.status?.toUpperCase() === "APPROVED");
  if (!raw) {
    throw new Error(`Approved WhatsApp template "${templateName}" was not found.`);
  }
  return describeTemplate(raw);
}

export type SendTemplateNotificationInput = {
  phoneE164: string;
  // Opaque DB id of the recipient, used for the conversation session and for
  // failure logging (never log the phone number itself).
  userId?: string | null;
  templateName: string;
  bodyParams: string[];
  // Pre-resolved send inputs (body/header/button) for personalized broadcasts. When provided, this
  // supersedes bodyParams and is passed straight to buildSendComponents.
  inputs?: SendComponentInputs;
  // Tags the outbound message's raw_payload so sends are filterable by origin
  // (e.g. "admin_welcome", "department_issue_contact", "escalation_oncall").
  source: string;
  // Extra raw_payload fields for traceability (e.g. issue_id, department_id).
  rawPayloadExtra?: Record<string, unknown>;
  // Pre-resolved descriptor to reuse across a fan-out; resolved on demand if omitted.
  descriptor?: TemplateDescriptor;
};

// Send one template notification and log it. Never throws — returns a status so
// callers can surface per-channel outcomes; the error string is included for
// callers that collect human-readable failures (e.g. the welcome flow).
export async function sendTemplateNotification(input: SendTemplateNotificationInput): Promise<TemplateSendResult> {
  try {
    const desc = input.descriptor ?? (await resolveApprovedTemplate(input.templateName));
    const sendInputs: SendComponentInputs = input.inputs ?? { bodyParams: input.bodyParams };
    const bodyParams = sendInputs.bodyParams ?? [];
    if (bodyParams.length < desc.bodyVarCount) {
      throw new Error(`Template "${desc.name}" expects ${desc.bodyVarCount} variables, received ${bodyParams.length}.`);
    }

    const components = buildSendComponents(sendInputs, desc);
    const metaResponse = await sendWhatsAppTemplateComponents(input.phoneE164, desc.name, desc.language, components);
    const waMessageId = metaResponse.messages?.[0]?.id;

    await recordOutboundMessage({
      phoneE164: input.phoneE164,
      body: `[template:${desc.name}] ${previewBody(desc.bodyText, bodyParams, desc.bodyVars)}`.trim(),
      whatsappMessageId: waMessageId,
      rawPayload: {
        source: input.source,
        template: desc.name,
        ...input.rawPayloadExtra,
        meta_response: metaResponse,
      },
    });
    await touchConversationSession({ phoneE164: input.phoneE164, userId: input.userId ?? undefined });

    return { status: "sent", waMessageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : `WhatsApp template "${input.templateName}" send failed.`;
    // Log an opaque id only — never the phone number or message body.
    console.error(`WhatsApp template "${input.templateName}" failed (user ${input.userId ?? "unknown"}):`, err);
    return { status: "failed", error: message };
  }
}
