import { describe, expect, it } from "vitest";

import { extractIncomingMessages } from "@/lib/whatsapp/parser";
import { scopeToEntries } from "@/lib/rsvp/meal-rsvp";

function payload(message: Record<string, unknown>) {
  return {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "pn1", display_phone_number: "+1630" }, contacts: [{ wa_id: "15551234567", profile: { name: "X" } }], messages: [message] } }] }],
  };
}

describe("parser buttonPayload", () => {
  it("extracts a template quick-reply button payload", () => {
    const [msg] = extractIncomingMessages(
      payload({ from: "15551234567", id: "wamid.1", type: "button", button: { text: "Faqat duphere", payload: "niyaz|ind|lunch|2026-06-16" } }),
    );
    expect(msg.buttonPayload).toBe("niyaz|ind|lunch|2026-06-16");
    expect(msg.body).toBe("Faqat duphere");
  });

  it("extracts an interactive button_reply id as the payload", () => {
    const [msg] = extractIncomingMessages(
      payload({ from: "15551234567", id: "wamid.2", type: "interactive", interactive: { button_reply: { id: "niyaz|fam|none|2026-06-17", title: "Nahi" } } }),
    );
    expect(msg.buttonPayload).toBe("niyaz|fam|none|2026-06-17");
  });

  it("leaves buttonPayload null for a plain text message", () => {
    const [msg] = extractIncomingMessages(payload({ from: "15551234567", id: "wamid.3", type: "text", text: { body: "hi" } }));
    expect(msg.buttonPayload).toBeNull();
  });
});

describe("scopeToEntries", () => {
  const D = "2026-06-16";
  it("both → all events that day attending", () => {
    expect(scopeToEntries("both", D)).toEqual([{ attending: true, dates: [D] }]);
  });
  it("none → all events that day not attending", () => {
    expect(scopeToEntries("none", D)).toEqual([{ attending: false, dates: [D] }]);
  });
  it("lunch → lunch yes, dinner no", () => {
    expect(scopeToEntries("lunch", D)).toEqual([
      { attending: true, meal: "lunch", dates: [D] },
      { attending: false, meal: "dinner", dates: [D] },
    ]);
  });
  it("dinner → lunch no, dinner yes", () => {
    expect(scopeToEntries("dinner", D)).toEqual([
      { attending: false, meal: "lunch", dates: [D] },
      { attending: true, meal: "dinner", dates: [D] },
    ]);
  });
});
