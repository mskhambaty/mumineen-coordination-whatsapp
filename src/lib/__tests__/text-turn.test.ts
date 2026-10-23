import { beforeEach, describe, expect, it, vi } from "vitest";

// after() runs the callback inline so the coalesced agent run is observable in the test.
const afterTasks: Array<Promise<unknown>> = [];
vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => {
    afterTasks.push(fn());
  },
}));

const runAgent = vi.fn(async () => "Agent reply");
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: (...args: unknown[]) => runAgent(...(args as [])) }));

let handlingMode: string | null = "ai";
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: handlingMode ? { handling_mode: handlingMode } : null }) }) }),
    }),
  }),
}));

const isRegistrationGateEnabled = vi.fn(async () => false);
vi.mock("@/lib/mumineen/registration", () => ({
  isRegistrationGateEnabled: () => isRegistrationGateEnabled(),
  getRegistrationStatus: vi.fn(async () => ({ registered: false })),
}));
vi.mock("@/lib/api/auth", () => ({ resolveCallerFromPhone: vi.fn(async () => Promise.reject(new Error("User not found"))) }));

const findOpenPrompt = vi.fn(async () => null as unknown);
vi.mock("@/lib/rsvp/niyaz-prompt", () => ({
  findOpenPrompt: () => findOpenPrompt(),
  consumePrompt: vi.fn(async () => undefined),
}));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({
  recordFamilyHeadCount: vi.fn(async () => ({})),
  recordUnregisteredHeadCount: vi.fn(async () => undefined),
}));

const insertPendingMessage = vi.fn(async () => undefined);
vi.mock("@/lib/whatsapp/coalesce", () => ({
  insertPendingMessage: (...args: unknown[]) => insertPendingMessage(...(args as [])),
  runCoalescedInbound: async (opts: { process: (t: string) => Promise<string>; send: (r: string) => Promise<void> }) => {
    await opts.send(await opts.process("hello"));
    return { ran: true };
  },
}));

import { handleInboundText } from "@/lib/agent/text-turn";

const user = { id: "u1", phone_e164: "+13125550100", role: "committee" as const };

function turn(overrides: Partial<Parameters<typeof handleInboundText>[0]> = {}) {
  const deliver = vi.fn(async () => undefined);
  const run = handleInboundText({
    user,
    phoneE164: user.phone_e164,
    body: "hello",
    messageId: "inapp:1",
    inboundId: "row-1",
    deliver,
    ...overrides,
  });
  return { deliver, run };
}

async function settle() {
  await Promise.all(afterTasks.splice(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  handlingMode = "ai";
  runAgent.mockResolvedValue("Agent reply");
  findOpenPrompt.mockResolvedValue(null);
  isRegistrationGateEnabled.mockResolvedValue(false);
});

describe("handleInboundText", () => {
  it("runs the agent as the real user and delivers its reply", async () => {
    const { deliver, run } = turn();
    await run;
    await settle();
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ user, visitorMode: undefined }));
    expect(deliver).toHaveBeenCalledWith("Agent reply");
  });

  it("visitor mode runs the agent as a visitor (narrows role, skips real permissions)", async () => {
    const { run } = turn({ visitorMode: true });
    await run;
    await settle();
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ role: "visitor" }), visitorMode: true }),
    );
  });

  it("does not run the agent when the conversation is in manual mode", async () => {
    handlingMode = "manual";
    const { deliver, run } = turn();
    await run;
    await settle();
    expect(insertPendingMessage).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("stays silent on a [[NO_REPLY]] agent reply", async () => {
    runAgent.mockResolvedValue("[[NO_REPLY]]");
    const { deliver, run } = turn();
    await run;
    await settle();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("nudges an unregistered non-internal user when the registration gate is on", async () => {
    isRegistrationGateEnabled.mockResolvedValue(true);
    const { deliver, run } = turn();
    await run;
    await settle();
    expect(runAgent).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(expect.stringContaining("isn't registered"), { source: "registration_gate" });
  });

  it("answers an open RSVP head-count prompt through deliver, skipping the agent", async () => {
    findOpenPrompt.mockResolvedValue({ id: "p1", family_id: "f1", event_date: "2026-07-01" });
    const { deliver, run } = turn({ body: "5" });
    await run;
    await settle();
    expect(runAgent).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(
      expect.stringContaining("Recorded 5"),
      expect.objectContaining({ source: "niyaz_rsvp_headcount", head_count: 5 }),
    );
  });

  it("calls replyInsteadOfAgent (WhatsApp images) after the gates instead of the agent", async () => {
    const replyInsteadOfAgent = vi.fn(async () => undefined);
    const { run } = turn({ replyInsteadOfAgent });
    await run;
    await settle();
    expect(replyInsteadOfAgent).toHaveBeenCalledOnce();
    expect(runAgent).not.toHaveBeenCalled();
  });
});
