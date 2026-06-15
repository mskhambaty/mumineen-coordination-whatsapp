import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Templates differ by account: primary's WABA owns "welcome", broadcast's WABA owns "promo".
const listMessageTemplates = vi.fn(async (account?: { wabaId?: string }) => {
  const body = [{ type: "BODY", text: "hi" }];
  if (account?.wabaId === "WABA2") {
    return [{ name: "promo", language: "en_US", status: "APPROVED", components: body }];
  }
  return [{ name: "welcome", language: "en_US", status: "APPROVED", components: body }];
});

vi.mock("@/lib/meta/whatsapp", () => ({
  listMessageTemplates: (...a: unknown[]) => listMessageTemplates(...a),
  sendWhatsAppTemplateComponents: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  recordOutboundMessage: vi.fn(),
  touchConversationSession: vi.fn(),
}));

import { listApprovedTemplatesForAllAccounts, resolveApprovedTemplateForAnyAccount } from "@/lib/whatsapp/send-template";

const MANAGED_KEYS = [
  "WHATSAPP_PHONE_NUMBER_ID", "Whatsapp_phone_number_id",
  "WHATSAPP_ACCESS_TOKEN", "Whatsapp_access_token",
  "WHATSAPP_BUSINESS_ACCOUNT_ID", "Whatsapp_business_account_id",
  "META_APP_SECRET", "Meta_app_secret",
  "META_WEBHOOK_VERIFY_TOKEN", "Meta_webhook_verify_token",
  "WHATSAPP_DISPLAY_PHONE_NUMBER", "Whatsapp_display_phone_number",
  "WHATSAPP_PHONE_NUMBER_ID_BROADCAST", "Whatsapp_phone_number_id_broadcast",
  "WHATSAPP_ACCESS_TOKEN_BROADCAST", "Whatsapp_access_token_broadcast",
  "WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST", "Whatsapp_business_account_id_broadcast",
  "META_APP_SECRET_BROADCAST", "Meta_app_secret_broadcast",
  "META_WEBHOOK_VERIFY_TOKEN_BROADCAST", "Meta_webhook_verify_token_broadcast",
  "WHATSAPP_DISPLAY_PHONE_NUMBER_BROADCAST", "Whatsapp_display_phone_number_broadcast",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const key of MANAGED_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PN1";
  process.env.WHATSAPP_ACCESS_TOKEN = "t1";
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "WABA1";
  process.env.WHATSAPP_PHONE_NUMBER_ID_BROADCAST = "PN2";
  process.env.WHATSAPP_ACCESS_TOKEN_BROADCAST = "t2";
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST = "WABA2";
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("resolveApprovedTemplateForAnyAccount", () => {
  it("returns the account whose WABA owns the template (the template determines the number)", async () => {
    const promo = await resolveApprovedTemplateForAnyAccount("promo");
    expect(promo.account.label).toBe("broadcast");
    expect(promo.account.phoneNumberId).toBe("PN2");
    expect(promo.descriptor.name).toBe("promo");

    const welcome = await resolveApprovedTemplateForAnyAccount("welcome");
    expect(welcome.account.label).toBe("primary");
    expect(welcome.account.phoneNumberId).toBe("PN1");
  });

  it("throws when no account has the approved template", async () => {
    await expect(resolveApprovedTemplateForAnyAccount("nope")).rejects.toThrow(/was not found/);
  });
});

describe("listApprovedTemplatesForAllAccounts", () => {
  it("returns every account's templates tagged with the owning account/WABA/number", async () => {
    const all = await listApprovedTemplatesForAllAccounts();
    const byName = new Map(all.map((t) => [t.name, t]));
    expect(byName.get("welcome")).toMatchObject({ accountLabel: "primary", wabaId: "WABA1", phoneNumberId: "PN1" });
    expect(byName.get("promo")).toMatchObject({ accountLabel: "broadcast", wabaId: "WABA2", phoneNumberId: "PN2" });
  });
});
