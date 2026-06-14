import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  sendRawEmail: vi.fn(),
  optionalEnv: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => mocks.getSupabaseAdmin() }));
vi.mock("@/lib/email/postmark", () => ({ sendRawEmail: (...a: unknown[]) => mocks.sendRawEmail(...a) }));
vi.mock("@/lib/env", () => ({
  optionalEnv: (n: string) => mocks.optionalEnv(n),
  requireEnv: (n: string) => n,
}));

import { recordMissingLisanWord, markWordRequestAdded } from "@/lib/knowledge/lisan-word-requests";
import { normalizeWord } from "@/lib/knowledge/lisan-words";

// A chainable, awaitable query stub: .eq() keeps chaining, .maybeSingle() / await resolve `result`.
function makeSupabase({ existingOpen = null as unknown, insertError = null as unknown } = {}) {
  const calls = { insert: [] as unknown[], update: [] as unknown[], fromTables: [] as string[] };
  const chain = (result: unknown): unknown => ({
    eq: () => chain(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  });
  const client = {
    from: (table: string) => {
      calls.fromTables.push(table);
      return {
        select: () => chain({ data: existingOpen }),
        update: (vals: unknown) => { calls.update.push(vals); return chain({ error: null }); },
        insert: (vals: unknown) => { calls.insert.push(vals); return Promise.resolve({ error: insertError }); },
      };
    },
  };
  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: an owner address is configured; app url is not.
  mocks.optionalEnv.mockImplementation((n: string) => (n === "LISAN_ALERT_EMAIL" ? "owner@example.com" : undefined));
});

describe("recordMissingLisanWord", () => {
  it("first sighting of a word inserts a queue row AND emails the owner once", async () => {
    const { client, calls } = makeSupabase({ existingOpen: null });
    mocks.getSupabaseAdmin.mockReturnValue(client);

    const res = await recordMissingLisanWord("kaffaarat", "+15551234567");

    expect(res).toEqual({ status: "logged", created: true });
    expect(calls.insert).toHaveLength(1);
    expect(calls.insert[0]).toMatchObject({
      word: "kaffaarat",
      normalized_word: normalizeWord("kaffaarat"),
      last_phone_e164: "+15551234567",
    });
    expect(mocks.sendRawEmail).toHaveBeenCalledTimes(1);
    const [to, subject] = mocks.sendRawEmail.mock.calls[0];
    expect(to).toBe("owner@example.com");
    expect(String(subject)).toContain("kaffaarat");
  });

  it("a repeat ask aggregates onto the open row (times_seen++) and does NOT re-email", async () => {
    const { client, calls } = makeSupabase({ existingOpen: { id: "row1", times_seen: 2 } });
    mocks.getSupabaseAdmin.mockReturnValue(client);

    const res = await recordMissingLisanWord("kaffaarat", "+15551234567");

    expect(res).toEqual({ status: "logged", created: false });
    expect(calls.update[0]).toMatchObject({ times_seen: 3 });
    expect(calls.insert).toHaveLength(0);
    expect(mocks.sendRawEmail).not.toHaveBeenCalled();
  });

  it("skips trivial replies entirely (no DB, no email)", async () => {
    const { client, calls } = makeSupabase({ existingOpen: null });
    mocks.getSupabaseAdmin.mockReturnValue(client);

    for (const t of ["Yes", "2", "ok", "👍"]) {
      expect(await recordMissingLisanWord(t, "+1555")).toEqual({ status: "skipped" });
    }
    expect(calls.insert).toHaveLength(0);
    expect(mocks.sendRawEmail).not.toHaveBeenCalled();
  });

  it("still records the queue row when LISAN_ALERT_EMAIL is unset (just no email)", async () => {
    mocks.optionalEnv.mockReturnValue(undefined); // no recipient configured
    const { client, calls } = makeSupabase({ existingOpen: null });
    mocks.getSupabaseAdmin.mockReturnValue(client);

    const res = await recordMissingLisanWord("falaq", "+1555");

    expect(res).toEqual({ status: "logged", created: true });
    expect(calls.insert).toHaveLength(1);
    expect(mocks.sendRawEmail).not.toHaveBeenCalled();
  });
});

describe("markWordRequestAdded", () => {
  it("marks open requests for the normalized word as added", async () => {
    const { client, calls } = makeSupabase();
    mocks.getSupabaseAdmin.mockReturnValue(client);

    await markWordRequestAdded("kaffaarat");

    expect(calls.fromTables).toContain("lisan_word_requests");
    expect(calls.update[0]).toMatchObject({ status: "added" });
  });

  it("no-ops on empty input", async () => {
    const { client, calls } = makeSupabase();
    mocks.getSupabaseAdmin.mockReturnValue(client);
    await markWordRequestAdded("   ");
    expect(calls.update).toHaveLength(0);
  });
});
