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

  it("emails each team member with the escalation details", async () => {
    const count = await notifyEscalationTeam(NOTICE);

    expect(count).toBe(1);
    expect(sendEscalationEmail).toHaveBeenCalledWith(
      "alice@test.com",
      expect.objectContaining({
        name: "Alice",
        reason: "The user asked to speak with a human representative.",
        priority_label: "Normal",
        conversation_url: NOTICE.conversationUrl,
      }),
    );
  });

  it("labels urgent escalations URGENT in the email", async () => {
    await notifyEscalationTeam({ ...NOTICE, priority: "urgent" });
    expect(sendEscalationEmail).toHaveBeenCalledWith("alice@test.com", expect.objectContaining({ priority_label: "URGENT" }));
  });

  it("never sends a WhatsApp alert, even to members with a phone (the number is gone)", async () => {
    await notifyEscalationTeam(NOTICE);
    expect(resolveApprovedTemplate).not.toHaveBeenCalled();
    expect(sendTemplateNotification).not.toHaveBeenCalled();
  });

  it("skips members with no email", async () => {
    memberRows = [
      { user: { id: "u2", display_name: "Bob", email: null, phone_e164: "+13125550102" } },
    ];

    const count = await notifyEscalationTeam(NOTICE);

    expect(count).toBe(1);
    expect(sendEscalationEmail).not.toHaveBeenCalled();
    expect(sendTemplateNotification).not.toHaveBeenCalled();
  });
});
