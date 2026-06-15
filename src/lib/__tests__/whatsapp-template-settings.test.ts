import { describe, expect, it, vi } from "vitest";

import type { WhatsAppAccount } from "@/lib/whatsapp/accounts";

// Stored annotation rows across two WABAs, including a same-named template ("alpha") in both —
// the exact collision the (waba_id, name) key is meant to resolve.
const rows = [
  { template_name: "alpha", friendly_name: "Alpha legacy", is_active: true, waba_id: null },        // legacy → primary
  { template_name: "beta", friendly_name: "Beta primary", is_active: false, waba_id: "WABA_PRIMARY" },
  { template_name: "alpha", friendly_name: "Alpha broadcast", is_active: true, waba_id: "WABA_BCAST" },
  { template_name: "gamma", friendly_name: "Gamma broadcast", is_active: false, waba_id: "WABA_BCAST" },
];

const select = vi.fn(async () => ({ data: rows }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ select }) }),
}));

import { getTemplateSettings } from "@/lib/whatsapp/template-settings";

const primary: WhatsAppAccount = { label: "primary", phoneNumberId: "p", accessToken: "t", wabaId: "WABA_PRIMARY" };
const broadcast: WhatsAppAccount = { label: "broadcast", phoneNumberId: "b", accessToken: "t", wabaId: "WABA_BCAST" };

describe("getTemplateSettings — WABA-scoped", () => {
  it("primary sees legacy NULL rows plus its own WABA rows", async () => {
    const map = await getTemplateSettings(primary);
    expect(map.get("alpha")?.friendlyName).toBe("Alpha legacy");
    expect(map.get("beta")?.friendlyName).toBe("Beta primary");
    expect(map.has("gamma")).toBe(false);
  });

  it("broadcast sees only its own WABA rows — the same-named template does not collide", async () => {
    const map = await getTemplateSettings(broadcast);
    expect(map.get("alpha")?.friendlyName).toBe("Alpha broadcast");
    expect(map.get("gamma")?.friendlyName).toBe("Gamma broadcast");
    expect(map.has("beta")).toBe(false);
  });
});
