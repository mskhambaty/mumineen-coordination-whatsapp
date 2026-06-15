import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  sendRawEmail: vi.fn(),
  optionalEnv: vi.fn(),
  getReligiousMonitorEmails: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => mocks.getSupabaseAdmin() }));
vi.mock("@/lib/email/postmark", () => ({ sendRawEmail: (...a: unknown[]) => mocks.sendRawEmail(...a) }));
vi.mock("@/lib/env", () => ({ optionalEnv: (n: string) => mocks.optionalEnv(n), requireEnv: (n: string) => n }));
vi.mock("@/lib/knowledge/religious-monitors", () => ({ getReligiousMonitorEmails: () => mocks.getReligiousMonitorEmails() }));

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

const recipients = () => mocks.sendRawEmail.mock.calls.map((c) => c[0]).sort();

beforeEach(() => {
  vi.clearAllMocks();
  // Default: an owner address is configured, app url is not, no monitors.
  mocks.optionalEnv.mockImplementation((n: string) => (n === "LISAN_ALERT_EMAIL" ? "owner@example.com" : undefined));
  mocks.getReligiousMonitorEmails.mockResolvedValue([]);
  mocks.sendRawEmail.mockResolvedValue(undefined); // returns a Promise so fanOut's .catch is valid
});

describe("recordMissingLisanWord", () => {
  it("first sighting inserts a row AND emails the whole team (monitors + owner, deduped)", async () => {
    mocks.getReligiousMonitorEmails.mockResolvedValue([
      { name: "A", email: "a@x.com" },
      { name: "B", email: "b@x.com" },
      { name: "Owner", email: "owner@example.com" }, // dup of LISAN_ALERT_EMAIL
    ]);
    const { client, calls } = makeSupabase({ existingOpen: null });
    mocks.getSupabaseAdmin.mockReturnValue(client);

    const res = await recordMissingLisanWord("kaffaarat", "+15551234567");

    expect(res).toEqual({ status: "logged", created: true });
    expect(calls.insert[0]).toMatchObject({ word: "kaffaarat", normalized_word: normalizeWord("kaffaarat"), last_phone_e164: "+15551234567" });
    // One email per distinct recipient (owner deduped against the monitor list).
    expect(recipients()).toEqual(["a@x.com", "b@x.com", "owner@example.com"]);
    expect(String(mocks.sendRawEmail.mock.calls[0][1])).toContain("kaffaarat");
  });

  it("a repeat ask aggregates onto the open row (times_seen++) and does NOT re-email", async () => {
    const { client, calls } = makeSupabase({ existingOpen: { id: "row1", times_seen: 2 } });
    mocks.getSupabaseAdmin.mockReturnValue(client);
    const res = await recordMissingLisanWord("kaffaarat", "+15551234567");
    expect(res).toEqual({ status: "logged", created: false });
    expect(calls.update[0]).toMatchObject({ times_seen: 3 });
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

  it("records the row but sends nothing when there are no recipients (no monitors, no env)", async () => {
    mocks.optionalEnv.mockReturnValue(undefined);
    mocks.getReligiousMonitorEmails.mockResolvedValue([]);
    const { client, calls } = makeSupabase({ existingOpen: null });
    mocks.getSupabaseAdmin.mockReturnValue(client);
    const res = await recordMissingLisanWord("falaq", "+1555");
    expect(res).toEqual({ status: "logged", created: true });
    expect(calls.insert).toHaveLength(1);
    expect(mocks.sendRawEmail).not.toHaveBeenCalled();
  });
});

describe("markWordRequestAdded", () => {
  it("closes open requests AND emails the team when it closed >=1 (with meaning + addedBy)", async () => {
    mocks.getReligiousMonitorEmails.mockResolvedValue([{ name: "A", email: "a@x.com" }]);
    const { client, calls } = makeSupabase({ existingOpen: [{ id: "r1", word: "Kaffaarat" }] });
    mocks.getSupabaseAdmin.mockReturnValue(client);

    const res = await markWordRequestAdded("kaffaarat", { label: "Kaffaarat", meaning: "Atonement", addedBy: "Mustafa" });

    expect(res).toEqual({ closed: 1 });
    expect(calls.update[0]).toMatchObject({ status: "added" });
    // emailed the team (monitor a@x.com + owner@example.com)
    expect(recipients()).toEqual(["a@x.com", "owner@example.com"]);
    const [, subject, html] = mocks.sendRawEmail.mock.calls[0];
    expect(String(subject)).toContain("Kaffaarat");
    expect(String(html)).toContain("Atonement");
    expect(String(html)).toContain("Mustafa");
  });

  it("sends NOTHING when there was no open request to close (proactive add)", async () => {
    const { client, calls } = makeSupabase({ existingOpen: [] });
    mocks.getSupabaseAdmin.mockReturnValue(client);
    const res = await markWordRequestAdded("zzzz", { label: "Zzzz" });
    expect(res).toEqual({ closed: 0 });
    expect(calls.update).toHaveLength(0);
    expect(mocks.sendRawEmail).not.toHaveBeenCalled();
  });

  it("no-ops on empty input", async () => {
    const { client, calls } = makeSupabase();
    mocks.getSupabaseAdmin.mockReturnValue(client);
    expect(await markWordRequestAdded("   ")).toEqual({ closed: 0 });
    expect(calls.update).toHaveLength(0);
  });
});
