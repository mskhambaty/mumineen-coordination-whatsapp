import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for the createBroadcast explicit-recipient safety net: a list assembled by an
// upstream caller (Niyaz RSVP / CSV upload) must never enqueue the same number twice, and Meta-
// suppressed numbers must be dropped — all keyed on the normalized phone. There's no DB unique
// constraint on (broadcast_id, phone_e164), so this app-level guard is the guarantee.

const getInWindowPhones = vi.fn(async () => new Set<string>());
const suppressedPhones = vi.fn(async () => new Set<string>());

// Capture the recipient rows enqueued into template_broadcast_recipients.
let enqueued: { phone_e164: string }[] = [];

vi.mock("@/lib/whatsapp/audience", () => ({
  // Real phone normalization (mirrors src/lib/whatsapp/phone.ts) so "+1555…" and "1555…" collapse.
  // Defined inline because the vi.mock factory is hoisted above top-level consts.
  normalizePhone: (input: string) => {
    const digits = input.replace(/[^\d]/g, "");
    return digits ? `+${digits}` : input;
  },
  getInWindowPhones: () => getInWindowPhones(),
  utilityMessageCostUsd: () => 0,
  previewAudience: vi.fn(),
}));
vi.mock("@/lib/whatsapp/undeliverable", () => ({ suppressedPhones: () => suppressedPhones() }));
vi.mock("@/lib/whatsapp/accounts", () => ({ getAccountByPhoneNumberId: () => undefined }));
vi.mock("@/lib/whatsapp/send-template", () => ({
  resolveApprovedTemplate: vi.fn(async () => ({ language: "en_US", bodyVars: [], header: null, headerVar: null, urlButtons: [] })),
  sendTemplateNotification: vi.fn(),
}));
vi.mock("@/lib/whatsapp/templates", () => ({
  resolveBindings: () => ({ inputs: { bodyParams: [] }, skipReason: undefined }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => {
        if (table === "template_broadcast_recipients") enqueued.push(...(payload as { phone_e164: string }[]));
        return {
          select: () => ({ single: async () => ({ data: { id: "b1" }, error: null }) }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
        };
      },
    }),
  }),
}));

import { createBroadcast } from "@/lib/whatsapp/broadcast";
import type { Recipient } from "@/lib/whatsapp/audience";

beforeEach(() => {
  vi.clearAllMocks();
  enqueued = [];
  getInWindowPhones.mockResolvedValue(new Set<string>());
  suppressedPhones.mockResolvedValue(new Set<string>());
});

describe("createBroadcast explicit-recipient dedupe/suppression", () => {
  it("collapses duplicate numbers (incl. +/no-+ variants) and drops suppressed numbers", async () => {
    suppressedPhones.mockResolvedValue(new Set(["+15559998888"]));
    const recipients: Recipient[] = [
      { phone: "+15551234567", familyId: "f1" },
      { phone: "15551234567", familyId: "f1" }, // same number, no leading +
      { phone: "+15559998888", familyId: "f2" }, // suppressed → dropped
      { phone: "+15550000000", familyId: "f3" }, // distinct → kept
    ];

    const result = await createBroadcast({ templateCode: "niyaz_rsvp", recipients });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    expect(result.total).toBe(2);
    expect(enqueued).toHaveLength(2);
    expect(enqueued.map((r) => r.phone_e164).sort()).toEqual(["+15550000000", "+15551234567"]);
  });
});
