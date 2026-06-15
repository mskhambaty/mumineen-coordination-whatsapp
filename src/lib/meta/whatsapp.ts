import { createHmac, timingSafeEqual } from "crypto";

import { optionalEnv } from "@/lib/env";
import { getPrimaryAccount, type WhatsAppAccount } from "@/lib/whatsapp/accounts";

type MetaMessageResponse = {
  messages?: Array<{
    id?: string;
  }>;
};

// Validate the X-Hub-Signature-256 on an inbound webhook POST. The app secret is App-scoped, so
// for multi-account each route passes the account whose Meta App owns its callback URL; omitting
// the account falls back to the primary's secret (preserves single-account behavior). A missing
// secret means verification is disabled for that account (useful for local dev).
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  account?: WhatsAppAccount,
) {
  const appSecret = account ? account.appSecret : optionalEnv("META_APP_SECRET");

  if (!appSecret) {
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

export async function sendWhatsAppText(
  to: string,
  body: string,
  account: WhatsAppAccount = getPrimaryAccount(),
): Promise<MetaMessageResponse> {
  const apiVersion = optionalEnv("META_GRAPH_API_VERSION") || "v25.0";
  const { phoneNumberId, accessToken } = account;

  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          preview_url: false,
          body,
        },
      }),
    },
  );

  const responseBody = (await response.json().catch(() => ({}))) as MetaMessageResponse;

  if (!response.ok) {
    console.error("Meta send-message error", {
      status: response.status,
      responseBody,
    });
    throw new Error(`Meta send-message failed with status ${response.status}`);
  }

  return responseBody;
}

export type WaTemplateButton = { type: string; text?: string; url?: string };
export type WaTemplateComponent = {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // for HEADER: TEXT | IMAGE | VIDEO | DOCUMENT
  text?: string;
  buttons?: WaTemplateButton[];
};
export type WaTemplate = {
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: WaTemplateComponent[];
};

// List the WhatsApp Business Account's message templates (live from Meta). Templates are
// WABA-scoped, so this lists the templates owned by the given account's WABA; caller filters
// status. Defaults to the primary account when none is supplied.
export async function listMessageTemplates(
  account: WhatsAppAccount = getPrimaryAccount(),
): Promise<WaTemplate[]> {
  const waba = account.wabaId;
  if (!waba) {
    throw new Error(`WHATSAPP_BUSINESS_ACCOUNT_ID is not configured for the "${account.label}" account.`);
  }
  const accessToken = account.accessToken;
  const response = await fetch(
    `${graphBase()}/${waba}/message_templates?fields=name,language,status,category,components&limit=200`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = (await response.json().catch(() => ({}))) as { data?: WaTemplate[]; error?: { message?: string } };
  if (!response.ok) {
    const detail = body?.error?.message ?? `status ${response.status}`;
    throw new Error(`Failed to load templates: ${detail}`);
  }
  return body.data ?? [];
}

// Send a template message with a prebuilt components array (header/body/button parameters).
export async function sendWhatsAppTemplateComponents(
  to: string,
  templateName: string,
  language: string,
  components: unknown[],
  account: WhatsAppAccount = getPrimaryAccount(),
): Promise<MetaMessageResponse> {
  const { phoneNumberId, accessToken } = account;

  const template: Record<string, unknown> = { name: templateName, language: { code: language } };
  if (components.length > 0) template.components = components;

  const response = await fetch(`${graphBase()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template }),
  });

  const responseBody = (await response.json().catch(() => ({}))) as MetaMessageResponse;
  if (!response.ok) {
    console.error("Meta send-template(components) error", { status: response.status, responseBody, templateName });
    throw new Error(`Meta send-template failed with status ${response.status}`);
  }
  return responseBody;
}

function graphBase() {
  const apiVersion = optionalEnv("META_GRAPH_API_VERSION") || "v25.0";
  return `https://graph.facebook.com/${apiVersion}`;
}

// Download an inbound media object (e.g. a user's image) by its Meta media id.
// Two hops: resolve the media id to a short-lived URL, then fetch the bytes with the token.
export async function fetchWhatsAppMedia(
  mediaId: string,
  account: WhatsAppAccount = getPrimaryAccount(),
): Promise<{ buffer: Buffer; mimeType: string }> {
  const accessToken = account.accessToken;
  const headers = { Authorization: `Bearer ${accessToken}` };

  const metaRes = await fetch(`${graphBase()}/${mediaId}`, { headers });
  if (!metaRes.ok) {
    throw new Error(`Meta media lookup failed with status ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) {
    throw new Error("Meta media lookup returned no URL");
  }

  const fileRes = await fetch(meta.url, { headers });
  if (!fileRes.ok) {
    throw new Error(`Meta media download failed with status ${fileRes.status}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mimeType: meta.mime_type ?? "application/octet-stream" };
}

// Upload media (e.g. an admin-attached image) and return its media id for sending.
export async function uploadWhatsAppMedia(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  account: WhatsAppAccount = getPrimaryAccount(),
): Promise<string> {
  const { phoneNumberId, accessToken } = account;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

  const response = await fetch(`${graphBase()}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string };
  if (!response.ok || !body.id) {
    throw new Error(`Meta media upload failed with status ${response.status}`);
  }
  return body.id;
}

// Send an image message (by uploaded media id) with an optional caption.
export async function sendWhatsAppImage(
  to: string,
  mediaId: string,
  caption?: string,
  account: WhatsAppAccount = getPrimaryAccount(),
): Promise<MetaMessageResponse> {
  const { phoneNumberId, accessToken } = account;

  const response = await fetch(`${graphBase()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: caption ? { id: mediaId, caption } : { id: mediaId },
    }),
  });

  const responseBody = (await response.json().catch(() => ({}))) as MetaMessageResponse;
  if (!response.ok) {
    console.error("Meta send-image error", { status: response.status, responseBody });
    throw new Error(`Meta send-image failed with status ${response.status}`);
  }
  return responseBody;
}
