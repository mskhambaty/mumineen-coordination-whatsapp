import { beforeEach, describe, expect, it, vi } from "vitest";

import { notifyEscalationTeam, type EscalationNotice } from "@/lib/escalation/notify";

const sendEscalationEmail = vi.fn(async () => undefined);
const resolveApprovedTemplate = vi.fn(async () => ({ name: "escalation_ticket_assigned", language: "en_US", bodyVarCount: 3 }));
const sendTemplateNotification = vi.fn(async () => ({ status: "sent" as const }));

vi.mock("@/lib/email/postmark", () => ({
  sendEscalationEmail: (...args: unknown[]) => sendEscalationEmail(...args),
}));
vi.mock("@/lib/whatsapp/send-template", () => ({
  resolveApprovedTemplate: (...args: unknown[]) => resolveApprovedTemplate(...args),
  sendTemplateNotification: (...args: unknown[]) => sendTemplateNotification(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => makeSupabase(),
}));

let memberRows: Array<{ user: Record<string, unknown> | null }>;

function makeSupabase() {
  const builder: Record<string, unknown> = {
    select: () => builder,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: memberRows, error: null }).then(resolve),
  };
  return { from: () => builder };
}

const NOTICE: EscalationNotice = {
  guestName: "Guest",
  guestPhone: "+13125550000",
  reason: "The user asked to speak with a human representative.",
  priority: "normal",
  category: "registration",
  conversationUrl: "https://portal.test/admin/conversations?phone=%2B13125550000&tab=escalations",
};

describe("notifyEscalationTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberRows = [
      { user: { id: "u1", display_name: "Alice", email: "alice@test.com", phone_e164: "+13125550101" } },
    ];
  });

  it("emails and WhatsApps each team member with the mapped template variables", async () => {
    const count = await notifyEscalationTeam(NOTICE);

    expect(count).toBe(1);
    expect(sendEscalationEmail).toHaveBeenCalledOnce();

    expect(resolveApprovedTemplate).toHaveBeenCalledWith("escalation_ticket_assigned");
    expect(sendTemplateNotification).toHaveBeenCalledOnce();
    const input = sendTemplateNotification.mock.calls[0][0] as {
      phoneE164: string;
      userId: string | null;
      templateName: string;
      bodyParams: string[];
      source: string;
    };
    expect(input.phoneE164).toBe("+13125550101");
    expect(input.userId).toBe("u1");
    expect(input.templateName).toBe("escalation_ticket_assigned");
    expect(input.source).toBe("escalation_oncall");
    // {{1}} request label, {{2}} details/reason, {{3}} portal link.
    expect(input.bodyParams).toEqual([
      "Registration",
      "The user asked to speak with a human representative.",
      "https://portal.test/admin/conversations?phone=%2B13125550000&tab=escalations",
    ]);
  });

  it("prefixes the request label with URGENT for urgent escalations", async () => {
    await notifyEscalationTeam({ ...NOTICE, priority: "urgent" });
    const input = sendTemplateNotification.mock.calls[0][0] as { bodyParams: string[] };
    expect(input.bodyParams[0]).toBe("URGENT — Registration");
  });

  it("sends WhatsApp but skips email for members with no email", async () => {
    memberRows = [
      { user: { id: "u2", display_name: "Bob", email: null, phone_e164: "+13125550102" } },
    ];

    const count = await notifyEscalationTeam(NOTICE);

    expect(count).toBe(1);
    expect(sendEscalationEmail).not.toHaveBeenCalled();
    expect(sendTemplateNotification).toHaveBeenCalledOnce();
  });

  it("emails a member with no phone but skips WhatsApp for them", async () => {
    memberRows = [
      { user: { id: "u3", display_name: "Carol", email: "carol@test.com", phone_e164: null } },
    ];

    const count = await notifyEscalationTeam(NOTICE);

    expect(count).toBe(1);
    expect(sendEscalationEmail).toHaveBeenCalledOnce();
    expect(resolveApprovedTemplate).not.toHaveBeenCalled();
    expect(sendTemplateNotification).not.toHaveBeenCalled();
  });

  it("still emails when the WhatsApp template cannot be resolved", async () => {
    resolveApprovedTemplate.mockRejectedValueOnce(new Error("Approved WhatsApp template was not found."));

    const count = await notifyEscalationTeam(NOTICE);

    expect(count).toBe(1);
    expect(sendEscalationEmail).toHaveBeenCalledOnce();
    expect(sendTemplateNotification).not.toHaveBeenCalled();
  });
});
