export type IncomingWhatsAppMessage = {
  businessPhoneNumberId?: string;
  businessDisplayPhoneNumber?: string;
  phoneE164: string;
  profileName?: string;
  whatsappMessageId: string;
  body: string;
  messageType: string;
  // Present for image messages: the Meta media id to download, plus any caption.
  media?: { id: string; mimeType?: string; caption?: string };
  // Present for quick-reply button taps: the button's payload (template quick_reply) or the
  // interactive button_reply id. Carries our send-time RSVP encoding (e.g. "niyaz|ind|lunch|2026-06-16").
  buttonPayload?: string | null;
  rawMessage: unknown;
};

type WhatsAppContact = {
  profile?: {
    name?: string;
  };
  wa_id?: string;
};

type WhatsAppMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: {
    body?: string;
  };
  button?: {
    text?: string;
    payload?: string;
  };
  interactive?: {
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
    };
  };
  image?: {
    id?: string;
    mime_type?: string;
    caption?: string;
  };
  reaction?: {
    emoji?: string;
    message_id?: string;
  };
};

type WhatsAppChange = {
  value?: {
    contacts?: WhatsAppContact[];
    metadata?: {
      display_phone_number?: string;
      phone_number_id?: string;
    };
    messages?: WhatsAppMessage[];
  };
};

type WhatsAppEntry = {
  changes?: WhatsAppChange[];
};

type WhatsAppWebhookPayload = {
  entry?: WhatsAppEntry[];
};

export function normalizeWhatsAppPhone(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : phone;
}

export function extractIncomingMessages(payload: unknown): IncomingWhatsAppMessage[] {
  const webhook = payload as WhatsAppWebhookPayload;

  return (webhook.entry ?? []).flatMap((entry) =>
    (entry.changes ?? []).flatMap((change) => {
      const contacts = change.value?.contacts ?? [];
      const metadata = change.value?.metadata;
      const messages = change.value?.messages ?? [];

      return messages.flatMap((message) => {
        if (!message.from || !message.id || !message.type) {
          return [];
        }

        const contact = contacts.find((item) => item.wa_id === message.from);
        const media =
          message.type === "image" && message.image?.id
            ? { id: message.image.id, mimeType: message.image.mime_type, caption: message.image.caption?.trim() }
            : undefined;

        return [
          {
            businessPhoneNumberId: metadata?.phone_number_id,
            businessDisplayPhoneNumber: metadata?.display_phone_number
              ? normalizeWhatsAppPhone(metadata.display_phone_number)
              : undefined,
            phoneE164: normalizeWhatsAppPhone(message.from),
            profileName: contact?.profile?.name,
            whatsappMessageId: message.id,
            body: getMessageBody(message),
            messageType: message.type,
            media,
            buttonPayload:
              message.button?.payload ??
              message.interactive?.button_reply?.id ??
              message.interactive?.list_reply?.id ??
              null,
            rawMessage: {
              metadata: metadata ?? null,
              message,
            },
          },
        ];
      });
    }),
  );
}

function getMessageBody(message: WhatsAppMessage) {
  if (message.type === "text") {
    return message.text?.body?.trim() ?? "";
  }

  if (message.type === "button") {
    return message.button?.text?.trim() ?? "";
  }

  if (message.type === "interactive") {
    return (
      message.interactive?.button_reply?.title?.trim() ??
      message.interactive?.list_reply?.title?.trim() ??
      ""
    );
  }

  if (message.type === "image") {
    return message.image?.caption?.trim() ?? "";
  }

  if (message.type === "reaction") {
    return message.reaction?.emoji?.trim() ?? "";
  }

  return "";
}
