import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatCommittees, sendAdminWelcomeNotification, shouldSendWelcome } from "@/lib/admin/onboarding";

const issuePasswordResetLink = vi.fn(async () => ({ url: "https://app.test/admin/reset-password?token=abc" }));
const sendWelcomeAdminEmail = vi.fn(async () => undefined);
const listMessageTemplates = vi.fn();
const sendWhatsAppTemplateComponents = vi.fn(async () => ({ messages: [{ id: "wamid.1" }] }));
const recordOutboundMessage = vi.fn(async () => undefined);
const touchConversationSession = vi.fn(async () => undefined);
const userUpdates: Array<Record<string, unknown>> = [];

vi.mock("@/lib/admin/password-reset", () => ({
  issuePasswordResetLink: (...args: unknown[]) => issuePasswordResetLink(...args),
  getMemberFacingAppUrl: () => "https://app.test",
}));
vi.mock("@/lib/email/postmark", () => ({
  sendWelcomeAdminEmail: (...args: unknown[]) => sendWelcomeAdminEmail(...args),
}));
vi.mock("@/lib/meta/whatsapp", () => ({
  listMessageTemplates: () => listMessageTemplates(),
  sendWhatsAppTemplateComponents: (...args: unknown[]) => sendWhatsAppTemplateComponents(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => makeSupabase(),
  recordOutboundMessage: (...args: unknown[]) => recordOutboundMessage(...args),
  touchConversationSession: (...args: unknown[]) => touchConversationSession(...args),
}));

// Per-test fixtures the mocked Supabase client reads from.
let userRow: Record<string, unknown> | null;
let membershipRows: Array<{ department: { name: string | null } }>;
const deptRow = { id: "dept-1", name: "Parking" };

function makeSupabase() {
  return {
    from(table: string) {
      let isUpdate = false;
      const builder = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          isUpdate = true;
          if (table === "whatsapp_users") userUpdates.push(payload);
          return builder;
        },
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "whatsapp_users" ? userRow : table === "departments" ? deptRow : null,
            error: null,
          }),
        // Queries that don't end in maybeSingle() await the builder directly:
        // the welcomed_at stamp (update) and the active-committees lookup.
        then: (resolve: (v: { data?: unknown; error: null }) => unknown) => {
          if (table === "department_members" && !isUpdate) {
            return Promise.resolve({ data: membershipRows, error: null }).then(resolve);
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

const APPROVED_TEMPLATE = {
  name: "committee_platform_access_created",
  language: "en",
  status: "APPROVED",
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text: "Hi {{1}}, ... committee member for {{2}}. ... use this link: {{3}} ... Admin portal login: {{4}}",
    },
  ],
};

describe("shouldSendWelcome", () => {
  it("sends when the user has never been welcomed", () => {
    expect(shouldSendWelcome(null, false)).toBe(true);
    expect(shouldSendWelcome(undefined, false)).toBe(true);
  });

  it("skips an already-welcomed user unless forced", () => {
    expect(shouldSendWelcome("2026-06-06T00:00:00.000Z", false)).toBe(false);
    expect(shouldSendWelcome("2026-06-06T00:00:00.000Z", true)).toBe(true);
  });
});

describe("formatCommittees", () => {
  it("uses the fallback when there are no committees", () => {
    expect(formatCommittees([], "your committee")).toBe("your committee");
  });
  it("formats one, two, and three-or-more committees", () => {
    expect(formatCommittees(["Parking"], "x")).toBe("Parking");
    expect(formatCommittees(["Parking", "Security"], "x")).toBe("Parking and Security");
    expect(formatCommittees(["Parking", "Security", "Food"], "x")).toBe("Parking, Security, and Food");
  });
});

describe("sendAdminWelcomeNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userUpdates.length = 0;
    listMessageTemplates.mockResolvedValue([APPROVED_TEMPLATE]);
    membershipRows = [{ department: { name: "Parking" } }];
    userRow = {
      id: "user-1",
      display_name: "Member Name",
      email: "member@example.com",
      phone_e164: "+13125550100",
      welcomed_at: null,
    };
  });

  it("welcomes a new member over email and the approved WhatsApp template with all 4 variables", async () => {
    const result = await sendAdminWelcomeNotification({ userId: "user-1", departmentId: "dept-1" });

    expect(result.email).toBe("sent");
    expect(result.whatsapp).toBe("sent");
    expect(result.already_welcomed).toBe(false);

    // Template sent by its real name + language, with a BODY component carrying
    // name, committee, password-setup link, and the hard-coded portal login.
    expect(sendWhatsAppTemplateComponents).toHaveBeenCalledOnce();
    const [phone, name, language, components] = sendWhatsAppTemplateComponents.mock.calls[0];
    expect(phone).toBe("+13125550100");
    expect(name).toBe("committee_platform_access_created");
    expect(language).toBe("en");
    const body = (components as Array<{ type: string; parameters: Array<{ text: string }> }>).find((c) => c.type === "body");
    expect(body?.parameters.map((p) => p.text)).toEqual([
      "Member Name",
      "Parking",
      "https://app.test/admin/reset-password?token=abc",
      "https://www.chicagorelaycenter.com/admin/login",
    ]);

    // First successful send stamps welcomed_at.
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0]).toHaveProperty("welcomed_at");
  });

  it("lists every active committee in the welcome", async () => {
    membershipRows = [{ department: { name: "Parking" } }, { department: { name: "Security" } }];

    await sendAdminWelcomeNotification({ userId: "user-1", departmentId: "dept-1" });

    const components = sendWhatsAppTemplateComponents.mock.calls[0][3] as Array<{ type: string; parameters: Array<{ text: string }> }>;
    const body = components.find((c) => c.type === "body");
    expect(body?.parameters[1].text).toBe("Parking and Security");
  });

  it("does not re-welcome a user already welcomed (automatic path)", async () => {
    userRow = { ...userRow!, welcomed_at: "2026-06-01T00:00:00.000Z" };

    const result = await sendAdminWelcomeNotification({ userId: "user-1", departmentId: "dept-1" });

    expect(result.already_welcomed).toBe(true);
    expect(result.email).toBe("skipped");
    expect(result.whatsapp).toBe("skipped");
    expect(sendWelcomeAdminEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplateComponents).not.toHaveBeenCalled();
    expect(userUpdates).toHaveLength(0);
  });

  it("re-sends to an already-welcomed user when forced (manual admin action)", async () => {
    userRow = { ...userRow!, welcomed_at: "2026-06-01T00:00:00.000Z" };

    const result = await sendAdminWelcomeNotification({ userId: "user-1", departmentId: "dept-1", force: true });

    expect(result.already_welcomed).toBe(false);
    expect(result.email).toBe("sent");
    expect(result.whatsapp).toBe("sent");
    expect(sendWhatsAppTemplateComponents).toHaveBeenCalledOnce();
  });

  it("does not stamp welcomed_at when every channel fails", async () => {
    listMessageTemplates.mockResolvedValue([]); // template missing -> WhatsApp fails
    sendWelcomeAdminEmail.mockRejectedValueOnce(new Error("postmark down"));

    const result = await sendAdminWelcomeNotification({ userId: "user-1", departmentId: "dept-1" });

    expect(result.email).toBe("failed");
    expect(result.whatsapp).toBe("failed");
    expect(userUpdates).toHaveLength(0);
  });
});
