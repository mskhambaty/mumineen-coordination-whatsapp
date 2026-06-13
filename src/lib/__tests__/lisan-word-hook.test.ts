import { beforeEach, describe, expect, it, vi } from "vitest";

// Verify the agent hook: a get_lisan_word_meaning that comes back not_found queues a missing-word
// request (fire-and-forget); a hit or a "did you mean" does not.
const mocks = vi.hoisted(() => ({
  lookupLisanWord: vi.fn(),
  recordMissingLisanWord: vi.fn(),
  recordToolAudit: vi.fn(),
}));

vi.mock("@/lib/knowledge/lisan-words", () => ({ lookupLisanWord: mocks.lookupLisanWord }));
vi.mock("@/lib/knowledge/lisan-word-requests", () => ({ recordMissingLisanWord: mocks.recordMissingLisanWord }));
vi.mock("@/lib/supabase/server", () => ({ recordToolAudit: mocks.recordToolAudit, getSupabaseAdmin: vi.fn() }));

import { executeTool } from "@/lib/agent/tools";

const visitor = { id: "u1", phone_e164: "+1555", role: "visitor" as const, status: "active" };
const ctx = { user: visitor, phoneE164: "+15551234567" };
const call = (word: string) => executeTool("get_lisan_word_meaning", { word }, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordToolAudit.mockResolvedValue(undefined);
  mocks.recordMissingLisanWord.mockResolvedValue(undefined);
});

describe("get_lisan_word_meaning missing-word hook", () => {
  it("queues the word (with the asker's phone) when the lookup is not_found", async () => {
    mocks.lookupLisanWord.mockResolvedValue({ status: "not_found" });
    await call("لالچ");
    expect(mocks.recordMissingLisanWord).toHaveBeenCalledWith("لالچ", "+15551234567");
  });

  it("does NOT queue when the word is found", async () => {
    mocks.lookupLisanWord.mockResolvedValue({ status: "ok", matches: [{ transliteration: "Aab", lisan: "آب", meaning: "Water", example: null }] });
    await call("aab");
    expect(mocks.recordMissingLisanWord).not.toHaveBeenCalled();
  });

  it("does NOT queue on a 'did you mean' (the member already got close matches)", async () => {
    mocks.lookupLisanWord.mockResolvedValue({ status: "did_you_mean", suggestions: [] });
    await call("zohra");
    expect(mocks.recordMissingLisanWord).not.toHaveBeenCalled();
  });
});
