import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

import type { WhatsAppAccount } from "@/lib/whatsapp/accounts";

const PRIMARY: WhatsAppAccount = {
  label: "primary",
  phoneNumberId: "PN_PRIMARY",
  accessToken: "tok-primary",
  wabaId: "WABA_PRIMARY",
  appSecret: "sec-primary",
  verifyToken: "VERIFY_PRIMARY",
  displayNumber: "+13120000001",
};
const BROADCAST: WhatsAppAccount = {
  label: "broadcast",
  phoneNumberId: "PN_BROADCAST",
  accessToken: "tok-broadcast",
  wabaId: "WABA_BROADCAST",
  appSecret: "sec-broadcast",
  verifyToken: "VERIFY_BROADCAST",
  displayNumber: "+13120000002",
};
const ACCOUNTS = [PRIMARY, BROADCAST];

// Capture the send so we can assert which account (and therefore which number) the reply goes out from.
const sendWhatsAppText = vi.fn(async () => ({ messages: [{ id: "wamid.out" }] }));
const verifyMetaSignature = vi.fn(() => true);
const fetchWhatsAppMedia = vi.fn(async () => ({ buffer: Buffer.from(""), mimeType: "image/jpeg" }));
const extractIncomingMessages = vi.fn();
const extractStatusUpdates = vi.fn(() => []);
const recordNiyazButtonResponse = vi.fn(async () => undefined);
const resolveFamilyForPhone = vi.fn(async () => ({ muminId: "m1", familyId: "f1" }));
const recordInteractiveResponse = vi.fn(async () => undefined);
const recordNiyazRsvpFromInteractive = vi.fn(async () => ({ status: "recorded" as const }));
const insertPendingMessage = vi.fn(async () => undefined);

vi.mock("@/lib/whatsapp/accounts", () => ({
  getAccounts: () => ACCOUNTS,
  getAccountByPhoneNumberId: (id: string) => ACCOUNTS.find((a) => a.phoneNumberId === id),
}));
vi.mock("@/lib/meta/whatsapp", () => ({
  sendWhatsAppText: (...args: unknown[]) => sendWhatsAppText(...args),
  verifyMetaSignature: (...args: unknown[]) => verifyMetaSignature(...args),
  fetchWhatsAppMedia: (...args: unknown[]) => fetchWhatsAppMedia(...args),
}));
vi.mock("@/lib/whatsapp/parser", () => ({
  extractIncomingMessages: (...args: unknown[]) => extractIncomingMessages(...args),
}));
vi.mock("@/lib/whatsapp/broadcast-status", () => ({
  extractStatusUpdates: (...args: unknown[]) => extractStatusUpdates(...args),
  applyBroadcastStatuses: vi.fn(async () => undefined),
  markBroadcastReplied: vi.fn(async () => undefined),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: vi.fn(),
  getOrCreateWhatsappUser: vi.fn(async () => ({ id: "user-1" })),
  recordInboundMessage: vi.fn(async () => ({ inserted: true, id: "row-1" })),
  recordOutboundMessage: vi.fn(async () => undefined),
  touchConversationSession: vi.fn(async () => undefined),
}));
vi.mock("@/lib/rsvp/family", () => ({
  resolveFamilyForPhone: (...args: unknown[]) => resolveFamilyForPhone(...args),
}));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({
  recordNiyazButtonResponse: (...args: unknown[]) => recordNiyazButtonResponse(...args),
  recordUnregisteredRsvp: vi.fn(async () => undefined),
  recordUnregisteredHeadCount: vi.fn(async () => undefined),
  recordFamilyHeadCount: vi.fn(async () => undefined),
  scopeToEntries: vi.fn(() => []),
}));
vi.mock("@/lib/rsvp/niyaz-prompt", () => ({
  findOpenPrompt: vi.fn(async () => null),
  createPrompt: vi.fn(async () => undefined),
  consumePrompt: vi.fn(async () => undefined),
}));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: vi.fn() }));
vi.mock("@/lib/agent/vision", () => ({ answerImageQuestion: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({ resolveCallerFromPhone: vi.fn() }));
vi.mock("@/lib/mumineen/registration", () => ({
  isRegistrationGateEnabled: vi.fn(async () => false),
  getRegistrationStatus: vi.fn(async () => ({ registered: true })),
}));
vi.mock("@/lib/whatsapp/coalesce", () => ({
  insertPendingMessage: (...args: unknown[]) => insertPendingMessage(...args),
  runCoalescedInbound: vi.fn(async () => undefined),
}));
vi.mock("@/lib/whatsapp/interactive-responses", () => ({
  recordInteractiveResponse: (...args: unknown[]) => recordInteractiveResponse(...args),
}));
vi.mock("@/lib/rsvp/niyaz-interactive", () => ({
  recordNiyazRsvpFromInteractive: (...args: unknown[]) => recordNiyazRsvpFromInteractive(...args),
  parseCount: (v: unknown) => {
    const n = parseInt(String(v ?? "0"), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  },
  parseRsvpToken: (token: string | null | undefined) => {
    const parts = (token ?? "").split(":");
    if (parts[0] !== "rsvp" || parts.length < 3) return {};
    const dayId = Number(parts[2]);
    return { hofIts: parts[1] || undefined, dayId: Number.isFinite(dayId) ? dayId : undefined };
  },
}));

import { webhookReceive, webhookVerify } from "@/lib/whatsapp/inbound";

function getReq(params: Record<string, string>): NextRequest {
  const searchParams = new URLSearchParams(params);
  return { nextUrl: { searchParams } } as unknown as NextRequest;
}

// A webhook POST whose metadata.phone_number_id addresses a given account — this is what the shared
// route uses to pick which account (and app secret / sending number) the delivery belongs to.
function postReq(businessPhoneNumberId: string): NextRequest {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: businessPhoneNumberId } } }] }],
  });
  return {
    text: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

function niyazButtonMessage(businessPhoneNumberId: string) {
  return {
    phoneE164: "+13125559999",
    whatsappMessageId: "wamid.in",
    profileName: "Tester",
    messageType: "button",
    buttonPayload: "niyaz|fam|both|2026-06-20",
    body: "",
    businessPhoneNumberId,
    businessDisplayPhoneNumber: "+13120000002",
    media: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyMetaSignature.mockReturnValue(true);
  extractStatusUpdates.mockReturnValue([]);
  resolveFamilyForPhone.mockResolvedValue({ muminId: "m1", familyId: "f1" });
});

describe("webhookVerify (shared URL)", () => {
  it("echoes the challenge when the token matches ANY configured account's verify token", () => {
    expect(webhookVerify(getReq({ "hub.mode": "subscribe", "hub.verify_token": "VERIFY_BROADCAST", "hub.challenge": "abc" })).status).toBe(200);
    expect(webhookVerify(getReq({ "hub.mode": "subscribe", "hub.verify_token": "VERIFY_PRIMARY", "hub.challenge": "abc" })).status).toBe(200);
  });

  it("rejects a token that matches no account", () => {
    const res = webhookVerify(getReq({ "hub.mode": "subscribe", "hub.verify_token": "VERIFY_UNKNOWN", "hub.challenge": "abc" }));
    expect(res.status).toBe(403);
  });
});

describe("webhookReceive (shared URL) — reply echoes the receiving number", () => {
  it("resolves the account from metadata.phone_number_id and replies from that number", async () => {
    extractIncomingMessages.mockReturnValue([niyazButtonMessage("PN_BROADCAST")]);

    const res = await webhookReceive(postReq("PN_BROADCAST"));
    expect(await res.json()).toMatchObject({ received: true, processed: 1 });

    expect(sendWhatsAppText).toHaveBeenCalledOnce();
    // Third arg is the resolved account → the reply leaves from the broadcast number, not primary.
    expect(sendWhatsAppText.mock.calls[0][2]).toBe(BROADCAST);
    // The signature was verified with the broadcast account's secret.
    expect(verifyMetaSignature.mock.calls[0][2]).toBe(BROADCAST);
  });

  it("ignores a delivery addressed to a number we don't serve", async () => {
    extractIncomingMessages.mockReturnValue([niyazButtonMessage("PN_PRIMARY")]);

    const res = await webhookReceive(postReq("PN_UNCONFIGURED"));
    expect(await res.json()).toMatchObject({ processed: 0, ignored: "unknown_business_phone" });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(verifyMetaSignature).not.toHaveBeenCalled();
  });
});

describe("webhookReceive — interactive responses are captured raw (phase 1)", () => {
  it("stores a Flow completion and does NOT route it to the agent or record an RSVP", async () => {
    extractIncomingMessages.mockReturnValue([
      {
        phoneE164: "+13125559999",
        whatsappMessageId: "wamid.flow",
        profileName: "Tester",
        messageType: "interactive",
        buttonPayload: null,
        flowResponse: { flowToken: "rsvp:40495151:2", responseJson: { flow_token: "rsvp:40495151:2", hof_its: 40495151, registration_instance_id: 2, lunch_attending_count: "2", dinner_attending_count: "3" } },
        body: "",
        businessPhoneNumberId: "PN_BROADCAST",
        businessDisplayPhoneNumber: "+13120000002",
        media: undefined,
      },
    ]);

    const res = await webhookReceive(postReq("PN_BROADCAST"));
    expect(await res.json()).toMatchObject({ processed: 1 });
    expect(recordInteractiveResponse).toHaveBeenCalledWith({
      phoneE164: "+13125559999",
      waMessageId: "wamid.flow",
      type: "flow",
      flowToken: "rsvp:40495151:2",
      payload: { flow_token: "rsvp:40495151:2", hof_its: 40495151, registration_instance_id: 2, lunch_attending_count: "2", dinner_attending_count: "3" },
    });
    // Phase 2: decode into niyaz_rsvp with parsed family/day/counts.
    expect(recordNiyazRsvpFromInteractive).toHaveBeenCalledWith({ hofIts: "40495151", dayId: 2, lunchCount: 2, dinnerCount: 3, phone: "+13125559999" });
    expect(recordNiyazButtonResponse).not.toHaveBeenCalled();
    expect(insertPendingMessage).not.toHaveBeenCalled();
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("decodes a single-meal Flow (attending_count) and takes hof/day from the flow_token", async () => {
    extractIncomingMessages.mockReturnValue([
      {
        phoneE164: "+13125559999",
        whatsappMessageId: "wamid.single",
        profileName: "Tester",
        messageType: "interactive",
        buttonPayload: null,
        // Single-meal Flow returns one attending_count and omits registration_instance_id; the day +
        // family must come from the flow_token (rsvp:<hof>:<day_id>).
        flowResponse: { flowToken: "rsvp:40495151:10", responseJson: { flow_token: "rsvp:40495151:10", hof_its: 40495151, attending_count: "4" } },
        body: "",
        businessPhoneNumberId: "PN_BROADCAST",
        businessDisplayPhoneNumber: "+13120000002",
        media: undefined,
      },
    ]);

    const res = await webhookReceive(postReq("PN_BROADCAST"));
    expect(await res.json()).toMatchObject({ processed: 1 });
    expect(recordNiyazRsvpFromInteractive).toHaveBeenCalledWith({ hofIts: "40495151", dayId: 10, attendingCount: 4, phone: "+13125559999" });
    expect(insertPendingMessage).not.toHaveBeenCalled();
  });

  it("stores an 'rsvp:…:not-attending' quick-reply as a raw button response", async () => {
    extractIncomingMessages.mockReturnValue([
      {
        phoneE164: "+13125559999",
        whatsappMessageId: "wamid.na",
        profileName: "Tester",
        messageType: "button",
        buttonPayload: "rsvp:522382:159:not-attending",
        flowResponse: null,
        body: "",
        businessPhoneNumberId: "PN_BROADCAST",
        businessDisplayPhoneNumber: "+13120000002",
        media: undefined,
      },
    ]);

    const res = await webhookReceive(postReq("PN_BROADCAST"));
    expect(await res.json()).toMatchObject({ processed: 1 });
    expect(recordInteractiveResponse).toHaveBeenCalledWith({
      phoneE164: "+13125559999",
      waMessageId: "wamid.na",
      type: "button",
      flowToken: "rsvp:522382:159:not-attending",
      payload: { payload: "rsvp:522382:159:not-attending" },
    });
    // Phase 2: not-attending decodes to counts 0/0 for that family + day.
    expect(recordNiyazRsvpFromInteractive).toHaveBeenCalledWith({ hofIts: "522382", dayId: 159, lunchCount: 0, dinnerCount: 0, phone: "+13125559999" });
    expect(recordNiyazButtonResponse).not.toHaveBeenCalled();
  });

  it("replies 'registration has ended' when a response arrives after the cutoff", async () => {
    recordNiyazRsvpFromInteractive.mockResolvedValue({ status: "ended" as const, endedMessage: "RSVP has ended" } as never);
    extractIncomingMessages.mockReturnValue([
      {
        phoneE164: "+13125559999",
        whatsappMessageId: "wamid.flow2",
        profileName: "Tester",
        messageType: "interactive",
        buttonPayload: null,
        flowResponse: { flowToken: "rsvp:40495151:2", responseJson: { hof_its: 40495151, registration_instance_id: 2, lunch_attending_count: "2", dinner_attending_count: "2" } },
        body: "",
        businessPhoneNumberId: "PN_BROADCAST",
        businessDisplayPhoneNumber: "+13120000002",
        media: undefined,
      },
    ]);
    const res = await webhookReceive(postReq("PN_BROADCAST"));
    expect(await res.json()).toMatchObject({ processed: 1 });
    expect(sendWhatsAppText).toHaveBeenCalledWith("+13125559999", "RSVP has ended", BROADCAST);
  });
});
