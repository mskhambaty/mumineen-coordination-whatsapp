import { createHmac, timingSafeEqual } from "crypto";

import { optionalEnv, requireEnv } from "@/lib/env";

type MetaMessageResponse = {
  messages?: Array<{
    id?: string;
  }>;
};

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null) {
  const appSecret = optionalEnv("META_APP_SECRET");

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

export async function sendWhatsAppText(to: string, body: string): Promise<MetaMessageResponse> {
  const apiVersion = optionalEnv("META_GRAPH_API_VERSION") || "v23.0";
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");

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
