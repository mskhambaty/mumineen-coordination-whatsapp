import { describe, expect, it } from "vitest";

import { extractIncomingMessages } from "@/lib/whatsapp/parser";

describe("extractIncomingMessages", () => {
  it("extracts inbound WhatsApp text messages", () => {
    const result = extractIncomingMessages({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: {
                  display_phone_number: "16308190250",
                  phone_number_id: "1071263409410708",
                },
                contacts: [{ wa_id: "13125551212", profile: { name: "Mufaddal" } }],
                messages: [
                  {
                    from: "13125551212",
                    id: "wamid.123",
                    type: "text",
                    text: { body: "What time is waaz?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toEqual([
      {
        businessPhoneNumberId: "1071263409410708",
        businessDisplayPhoneNumber: "+16308190250",
        phoneE164: "+13125551212",
        profileName: "Mufaddal",
        whatsappMessageId: "wamid.123",
        body: "What time is waaz?",
        messageType: "text",
        buttonPayload: null,
        flowResponse: null,
        rawMessage: {
          metadata: {
            display_phone_number: "16308190250",
            phone_number_id: "1071263409410708",
          },
          message: {
            from: "13125551212",
            id: "wamid.123",
            type: "text",
            text: { body: "What time is waaz?" },
          },
        },
      },
    ]);
  });

  it("ignores status-only webhook payloads", () => {
    expect(
      extractIncomingMessages({
        entry: [{ changes: [{ value: { statuses: [{ id: "wamid.outbound" }] } }] }],
      }),
    ).toEqual([]);
  });

  it("extracts a WhatsApp Flow completion (nfm_reply) with its flow_token and decoded response", () => {
    const result = extractIncomingMessages({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: "16307638963", phone_number_id: "PN_BROADCAST" },
                contacts: [{ wa_id: "13125551212", profile: { name: "Mufaddal" } }],
                messages: [
                  {
                    from: "13125551212",
                    id: "wamid.flow",
                    type: "interactive",
                    interactive: {
                      type: "nfm_reply",
                      nfm_reply: {
                        name: "flow",
                        response_json: JSON.stringify({ flow_token: "rsvp:m1:e1", attending_count: 3 }),
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].flowResponse).toEqual({ flowToken: "rsvp:m1:e1", responseJson: { flow_token: "rsvp:m1:e1", attending_count: 3 } });
  });
});
