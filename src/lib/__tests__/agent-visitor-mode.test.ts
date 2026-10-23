import { beforeEach, describe, expect, it, vi } from "vitest";

// In-app "visitor mode" must only NARROW access: a committee/admin chatting in visitor mode gets the
// visitor tool list and a visitor prompt, and their real permissions are never resolved.

const create = vi.fn(async () => ({ choices: [{ message: { role: "assistant", content: "Happy to help." } }] }));
const fakeClient = {
  chat: { completions: { create } },
  embeddings: { create: vi.fn(async () => ({ data: [{ embedding: [] }] })) },
};

const resolveCallerFromPhone = vi.fn(async () => ({
  user_id: "u1",
  display_name: "Committee Member",
  role: "committee",
  global_role: "leadership_admin",
  can_read_all: true,
  can_write_all: true,
  departments: [],
}));

vi.mock("@/lib/ai/model", async (orig) => ({ ...(await orig()), getAIClient: () => fakeClient }));
vi.mock("@/lib/agent/prompts", () => ({ SYSTEM_PROMPT: "Test assistant.", loadAgentSystemPrompt: async () => "Test assistant.", loadRuleOverrides: async () => ({}) }));
vi.mock("@/lib/mumineen/sender-profile", () => ({ getSenderProfile: async () => null, formatSenderProfileForPrompt: () => "" }));
vi.mock("@/lib/api/auth", () => ({ resolveCallerFromPhone: (...a: unknown[]) => resolveCallerFromPhone(...(a as [])) }));
vi.mock("@/lib/supabase/server", () => ({
  getRecentMessages: async () => [{ direction: "inbound", body: "Can you help me with something?" }],
  recordToolAudit: async () => undefined,
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ order: async () => ({ data: [] }) }), insert: async () => ({ error: null }) }),
  }),
}));

import { runAgent } from "@/lib/agent/run-agent";

const committee = { id: "u1", phone_e164: "+13125550100", role: "committee" as const, status: "active" };

type CreateArgs = { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: unknown }> };
const lastCall = () => (create.mock.calls.at(-1) as unknown as [CreateArgs])[0];
const toolNames = () => (lastCall().tools ?? []).map((t) => t.function.name);
const systemPrompt = () => String(lastCall().messages[0].content);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runAgent — visitor mode", () => {
  it("without visitor mode, a committee member gets staff tools and their real permissions", async () => {
    await runAgent({ user: committee, phoneE164: committee.phone_e164, message: "Can you help me with something?" });
    expect(resolveCallerFromPhone).toHaveBeenCalled();
    expect(toolNames()).toContain("list_tasks");
    expect(systemPrompt()).toContain("Backend role: committee");
  });

  it("in visitor mode, staff tools are hidden and real permissions are never resolved", async () => {
    await runAgent({
      user: { ...committee, role: "visitor" },
      phoneE164: committee.phone_e164,
      message: "Can you help me with something?",
      visitorMode: true,
    });
    expect(resolveCallerFromPhone).not.toHaveBeenCalled();
    expect(toolNames()).not.toContain("list_tasks");
    expect(toolNames()).not.toContain("create_task");
    expect(toolNames()).toContain("move_to_escalation");
    expect(systemPrompt()).toContain("Backend role: visitor");
    expect(systemPrompt()).toContain("Global access: unknown");
  });
});
