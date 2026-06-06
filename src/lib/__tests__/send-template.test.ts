import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveApprovedTemplate, sendTemplateNotification } from "@/lib/whatsapp/send-template";

const listMessageTemplates = vi.fn();
const sendWhatsAppTemplateComponents = vi.fn(async () => ({ messages: [{ id: "wamid.1" }] }));
const recordOutboundMessage = vi.fn(async () => undefined);
const touchConversationSession = vi.fn(async () => undefined);

vi.mock("@/lib/meta/whatsapp", () => ({
  listMessageTemplates: () => listMessageTemplates(),
  sendWhatsAppTemplateComponents: (...args: unknown[]) => sendWhatsAppTemplateComponents(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  recordOutboundMessage: (...args: unknown[]) => recordOutboundMessage(...args),
  touchConversationSession: (...args: unknown[]) => touchConversationSession(...args),
}));

const APPROVED_TEMPLATE = {
  name: "department_ticket_assigned",
  language: "en_US",
  status: "APPROVED",
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text: "A new ticket has been assigned.\n\nIssue: {{1}}\nDescription: {{2}}\nView ticket: {{3}}",
    },
  ],
};

describe("resolveApprovedTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMessageTemplates.mockResolvedValue([APPROVED_TEMPLATE]);
  });

  it("returns the descriptor for an approved template", async () => {
    const desc = await resolveApprovedTemplate("department_ticket_assigned");
    expect(desc.name).toBe("department_ticket_assigned");
    expect(desc.language).toBe("en_US");
    expect(desc.bodyVarCount).toBe(3);
  });

  it("throws when the template is missing or not approved", async () => {
    listMessageTemplates.mockResolvedValue([{ ...APPROVED_TEMPLATE, status: "PENDING" }]);
    await expect(resolveApprovedTemplate("department_ticket_assigned")).rejects.toThrow(/was not found/);
  });
});

describe("sendTemplateNotification", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    listMessageTemplates.mockResolvedValue([APPROVED_TEMPLATE]);
  });

  afterEach(() => {
    errorSpy.mockClear();
  });

  it("resolves, sends, logs the outbound message, and refreshes the session", async () => {
    const result = await sendTemplateNotification({
      phoneE164: "+13125550100",
      userId: "user-1",
      templateName: "department_ticket_assigned",
      bodyParams: ["Broken gate", "The north gate is stuck", "https://portal.test/issues/1"],
      source: "department_issue_contact",
      rawPayloadExtra: { issue_id: "issue-1" },
    });

    expect(result.status).toBe("sent");

    const [phone, name, language, components] = sendWhatsAppTemplateComponents.mock.calls[0];
    expect(phone).toBe("+13125550100");
    expect(name).toBe("department_ticket_assigned");
    expect(language).toBe("en_US");
    const body = (components as Array<{ type: string; parameters: Array<{ text: string }> }>).find((c) => c.type === "body");
    expect(body?.parameters.map((p) => p.text)).toEqual([
      "Broken gate",
      "The north gate is stuck",
      "https://portal.test/issues/1",
    ]);

    // Outbound message logged with a rendered preview + traceable raw payload.
    expect(recordOutboundMessage).toHaveBeenCalledOnce();
    const recorded = recordOutboundMessage.mock.calls[0][0] as {
      phoneE164: string;
      body: string;
      whatsappMessageId?: string;
      rawPayload: Record<string, unknown>;
    };
    expect(recorded.body).toContain("[template:department_ticket_assigned]");
    expect(recorded.body).toContain("Broken gate");
    expect(recorded.whatsappMessageId).toBe("wamid.1");
    expect(recorded.rawPayload).toMatchObject({
      source: "department_issue_contact",
      template: "department_ticket_assigned",
      issue_id: "issue-1",
    });

    expect(touchConversationSession).toHaveBeenCalledWith({ phoneE164: "+13125550100", userId: "user-1" });
  });

  it("reuses a provided descriptor without re-fetching the template list", async () => {
    const descriptor = await resolveApprovedTemplate("department_ticket_assigned");
    listMessageTemplates.mockClear();

    const result = await sendTemplateNotification({
      phoneE164: "+13125550101",
      userId: "user-2",
      templateName: "department_ticket_assigned",
      bodyParams: ["a", "b", "c"],
      source: "department_issue_contact",
      descriptor,
    });

    expect(result.status).toBe("sent");
    expect(listMessageTemplates).not.toHaveBeenCalled();
  });

  it("fails (without sending) when fewer body params than the template requires", async () => {
    const result = await sendTemplateNotification({
      phoneE164: "+13125550102",
      userId: "user-3",
      templateName: "department_ticket_assigned",
      bodyParams: ["only one"],
      source: "department_issue_contact",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/expects 3 variables/);
    expect(sendWhatsAppTemplateComponents).not.toHaveBeenCalled();
    expect(recordOutboundMessage).not.toHaveBeenCalled();
  });

  it("returns failed when the template cannot be resolved", async () => {
    listMessageTemplates.mockResolvedValue([]);
    const result = await sendTemplateNotification({
      phoneE164: "+13125550103",
      userId: "user-4",
      templateName: "department_ticket_assigned",
      bodyParams: ["a", "b", "c"],
      source: "department_issue_contact",
    });
    expect(result.status).toBe("failed");
  });

  it("never logs the recipient phone number on failure", async () => {
    sendWhatsAppTemplateComponents.mockRejectedValueOnce(new Error("Meta send-template failed with status 400"));

    await sendTemplateNotification({
      phoneE164: "+13125550199",
      userId: "user-5",
      templateName: "department_ticket_assigned",
      bodyParams: ["a", "b", "c"],
      source: "department_issue_contact",
    });

    const logged = errorSpy.mock.calls.flat().map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
    expect(logged).not.toContain("+13125550199");
    expect(logged).toContain("user-5");
  });
});
