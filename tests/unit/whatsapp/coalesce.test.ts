import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseFrom: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: mocks.supabaseFrom }),
}));

import { runCoalescedInbound } from "@/lib/whatsapp/coalesce";

const LOCKS = "whatsapp_inbound_locks";
const PENDING = "whatsapp_pending_messages";

type ClaimBatch = Array<{ id: string; body: string; received_at: string; inbound_msg_id: string | null }>;
type MockRow = Record<string, unknown>;
type MockResult = { data: unknown; error: { code?: string; message?: string } | null };

// Self-referential builder type that mirrors the Supabase fluent query API used in coalesce.
type QB = {
  select(): QB;
  insert(rows: unknown): QB;
  update(): QB;
  delete(): QB;
  eq(...args: unknown[]): QB;
  lt(...args: unknown[]): QB;
  is(...args: unknown[]): QB;
  in(...args: unknown[]): QB;
  or(...args: unknown[]): QB;
  maybeSingle(): Promise<MockResult>;
  single(): Promise<MockResult>;
  then(onF: (v: MockResult) => unknown, onR?: (e: unknown) => unknown): Promise<unknown>;
};

function makeMock(opts: { acquire: boolean; claimBatches: ClaimBatch[]; owner: boolean }) {
  let lockOwnerToken: string | null = null;
  const batches = [...opts.claimBatches];

  function from(name: string) {
    const ctx: { op: "insert" | "update" | "delete" | null; selected: boolean; isNull: boolean } = {
      op: null,
      selected: false,
      isNull: false,
    };
    const builder: QB = {
      select() { ctx.selected = true; return builder; },
      insert(rows: unknown) {
        ctx.op = "insert";
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (name === LOCKS) lockOwnerToken = (row as MockRow)?.owner_token as string ?? null;
        return builder;
      },
      update() { ctx.op = "update"; return builder; },
      delete() { ctx.op = "delete"; return builder; },
      eq: () => builder,
      lt: () => builder,
      is: () => { ctx.isNull = true; return builder; },
      in: () => builder,
      or: () => builder,
      maybeSingle() {
        if (name === LOCKS && ctx.op === null) {
          return Promise.resolve({
            data: opts.owner
              ? { owner_token: lockOwnerToken, expires_at: new Date(Date.now() + 1e6).toISOString() }
              : { owner_token: "someone-else", expires_at: new Date(Date.now() + 1e6).toISOString() },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => Promise.resolve({ data: { id: "msg-1" }, error: null }),
      then(onF: (v: MockResult) => unknown, onR?: (e: unknown) => unknown) {
        let result: MockResult = { data: null, error: null };
        if (name === LOCKS && ctx.op === "insert") {
          result = opts.acquire
            ? { data: [{ lock_key: "k" }], error: null }
            : { data: null, error: { code: "23505", message: "dup" } };
        } else if (name === LOCKS && ctx.op === "update") {
          result = { data: [], error: null };
        } else if (name === PENDING && ctx.op === "update") {
          result = { data: ctx.isNull ? (batches.shift() ?? []) : [], error: null };
        } else if (ctx.selected) {
          result = { data: [], error: null };
        }
        return Promise.resolve(result).then(onF, onR);
      },
    };
    return builder;
  }

  return vi.fn(from);
}

const row = (id: string, body: string) => ({
  id,
  body,
  received_at: new Date(Date.parse("2026-06-01T00:00:00Z") + id.charCodeAt(0)).toISOString(),
  inbound_msg_id: `msg-${id}`,
});

beforeEach(() => vi.clearAllMocks());

describe("runCoalescedInbound", () => {
  it("returns without processing when the lock is held by another runner", async () => {
    mocks.supabaseFrom.mockImplementation(makeMock({ acquire: false, claimBatches: [], owner: false }));
    const process = vi.fn();
    const send = vi.fn();

    const res = await runCoalescedInbound({ lockKey: "+1234567890", process, send });

    expect(res).toEqual({ ran: false });
    expect(process).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("combines messages already queued into ONE process call and ONE send", async () => {
    mocks.supabaseFrom.mockImplementation(
      makeMock({ acquire: true, claimBatches: [[row("a", "hi"), row("b", "red car")], []], owner: true }),
    );
    const process = vi.fn().mockResolvedValue("Here is my reply");
    const send = vi.fn().mockResolvedValue(undefined);

    await runCoalescedInbound({ lockKey: "+1234567890", process, send });

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith("hi\n\nred car");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Here is my reply");
  });

  it("drains a message that arrives mid-run with a second pass, sending only the final reply", async () => {
    mocks.supabaseFrom.mockImplementation(
      makeMock({ acquire: true, claimBatches: [[row("a", "hi")], [row("b", "for next week")], []], owner: true }),
    );
    const results = ["Reply 1", "Reply 2"];
    const process = vi.fn().mockImplementation(() => Promise.resolve(results.shift()));
    const send = vi.fn().mockResolvedValue(undefined);

    await runCoalescedInbound({ lockKey: "+1234567890", process, send });

    expect(process).toHaveBeenCalledTimes(2);
    expect(process).toHaveBeenNthCalledWith(1, "hi");
    expect(process).toHaveBeenNthCalledWith(2, "for next week");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Reply 2");
  });

  it("skips send when the lease was stolen (no longer owner)", async () => {
    mocks.supabaseFrom.mockImplementation(
      makeMock({ acquire: true, claimBatches: [[row("a", "hi")], []], owner: false }),
    );
    const process = vi.fn().mockResolvedValue("Reply");
    const send = vi.fn();
    const settle = vi.fn().mockResolvedValue(undefined);

    await runCoalescedInbound({ lockKey: "+1234567890", process, send, settle });

    expect(process).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ sent: false, inboundMsgIds: ["msg-a"] }),
    );
  });

  it("calls settle with all inbound msg ids from the burst", async () => {
    mocks.supabaseFrom.mockImplementation(
      makeMock({ acquire: true, claimBatches: [[row("a", "hi"), row("b", "how are you")], []], owner: true }),
    );
    const process = vi.fn().mockResolvedValue("Reply");
    const send = vi.fn().mockResolvedValue(undefined);
    const settle = vi.fn().mockResolvedValue(undefined);

    await runCoalescedInbound({ lockKey: "+1234567890", process, send, settle });

    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ sent: true, inboundMsgIds: ["msg-a", "msg-b"] }),
    );
  });
});
