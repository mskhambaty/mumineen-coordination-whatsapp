import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for the duplicate-send bug: drainBroadcasts must claim a batch atomically via the
// claim_broadcast_recipients RPC (which flips rows 'queued' -> 'sending' under FOR UPDATE SKIP
// LOCKED) and send only the rows that RPC returns — never re-select by status and send. That claim
// is what stops two overlapping drains from grabbing the same recipient and double-sending.

const resolveApprovedTemplate = vi.fn(async () => ({ name: "t", language: "en_US" }));
const sendTemplateNotification = vi.fn(async () => ({ status: "sent" as const, waMessageId: "wamid.1" }));

vi.mock("@/lib/whatsapp/send-template", () => ({
  resolveApprovedTemplate: (...a: unknown[]) => resolveApprovedTemplate(...a),
  sendTemplateNotification: (...a: unknown[]) => sendTemplateNotification(...a),
}));
vi.mock("@/lib/whatsapp/audience", () => ({ previewAudience: vi.fn(), utilityMessageCostUsd: () => 0.04 }));
vi.mock("@/lib/whatsapp/templates", () => ({ resolveBindings: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => supabase }));

type ClaimRow = { id: string; broadcast_id: string; phone_e164: string; body_params: unknown; template_code: string; template_language: string };

let claimRows: ClaimRow[] = [];
// Optional per-call claim sequence: each drainBroadcasts() shifts one batch. Falls back to claimRows
// when empty (so existing single-drain tests are unaffected).
let batchQueue: ClaimRow[][] = [];
let runningBroadcasts: { id: string }[] = [];
let pendingCount = 0;
// Total recipient rows for a broadcast (queued+sending+sent+failed+skipped). finalizeCompletedBroadcasts
// reads this WITHOUT a send_status filter (no .in()), so the mock returns it when .in() wasn't called.
let totalCount = 0;
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const updateCalls: { table: string; values: Record<string, unknown>; eqVal?: unknown }[] = [];

const supabase = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "claim_broadcast_recipients") {
      if (batchQueue.length > 0) return { data: batchQueue.shift(), error: null };
      return { data: claimRows, error: null };
    }
    return { data: null, error: null };
  }),
  from: (table: string) => {
    const state: { values?: Record<string, unknown>; eqVal?: unknown; head: boolean; inCalled: boolean } = { head: false, inCalled: false };
    const builder: Record<string, unknown> = {
      select: (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) state.head = true;
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        state.values = values;
        return builder;
      },
      eq: (_field: string, val: unknown) => {
        state.eqVal = val;
        return builder;
      },
      in: () => {
        state.inCalled = true;
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (state.values !== undefined) {
          updateCalls.push({ table, values: state.values, eqVal: state.eqVal });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        if (table === "template_broadcasts") return Promise.resolve({ data: runningBroadcasts, error: null }).then(resolve);
        // Recipient head-counts: with .in([...]) → pending count; without → total recipient rows.
        if (state.head) return Promise.resolve({ count: state.inCalled ? pendingCount : totalCount, error: null }).then(resolve);
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return builder;
  },
};

import { drainBroadcasts, drainUntilEmpty } from "@/lib/whatsapp/broadcast";

const row = (id: string): ClaimRow => ({ id, broadcast_id: "b1", phone_e164: `+1312555${id}`, body_params: { bodyParams: ["a"] }, template_code: "t", template_language: "en_US" });

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  updateCalls.length = 0;
  claimRows = [];
  batchQueue = [];
  runningBroadcasts = [];
  pendingCount = 0;
  totalCount = 0;
  sendTemplateNotification.mockResolvedValue({ status: "sent", waMessageId: "wamid.1" });
});

describe("drainBroadcasts", () => {
  it("claims a batch atomically via the RPC and sends only the claimed rows", async () => {
    claimRows = [
      { id: "r1", broadcast_id: "b1", phone_e164: "+13125550001", body_params: { bodyParams: ["a"] }, template_code: "t", template_language: "en_US" },
      { id: "r2", broadcast_id: "b1", phone_e164: "+13125550002", body_params: { bodyParams: ["b"] }, template_code: "t", template_language: "en_US" },
    ];

    const result = await drainBroadcasts(150);

    // Recipients are claimed through the atomic RPC (not a status-filtered SELECT).
    const claim = rpcCalls.find((c) => c.fn === "claim_broadcast_recipients");
    expect(claim).toBeDefined();
    expect(claim?.args).toMatchObject({ p_batch_size: 150 });

    // Exactly one send per claimed recipient — no duplicates.
    expect(sendTemplateNotification).toHaveBeenCalledTimes(2);
    expect(sendTemplateNotification.mock.calls.map((c) => (c[0] as { phoneE164: string }).phoneE164)).toEqual([
      "+13125550001",
      "+13125550002",
    ]);

    // Each sent row is settled to 'sent', and the sent counter is bumped atomically.
    const sentUpdates = updateCalls.filter((u) => u.table === "template_broadcast_recipients" && u.values.send_status === "sent");
    expect(sentUpdates.map((u) => u.eqVal)).toEqual(["r1", "r2"]);
    expect(rpcCalls.filter((c) => c.fn === "bump_broadcast_counter" && c.args.p_field === "count_sent")).toHaveLength(2);

    expect(result.processed).toBe(2);
  });

  it("does nothing (no sends) when the claim returns no rows", async () => {
    claimRows = [];
    const result = await drainBroadcasts();
    expect(sendTemplateNotification).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it("marks a failed send as 'failed' and bumps the failed counter", async () => {
    claimRows = [
      { id: "r1", broadcast_id: "b1", phone_e164: "+13125550001", body_params: { bodyParams: ["a"] }, template_code: "t", template_language: "en_US" },
    ];
    sendTemplateNotification.mockResolvedValueOnce({ status: "failed" as const, error: "send failed" } as never);

    await drainBroadcasts();

    expect(updateCalls.some((u) => u.values.send_status === "failed" && u.eqVal === "r1")).toBe(true);
    expect(rpcCalls.filter((c) => c.fn === "bump_broadcast_counter" && c.args.p_field === "count_failed")).toHaveLength(1);
  });
});

describe("finalizeCompletedBroadcasts (run via drainBroadcasts when the claim is empty)", () => {
  const completed = () => updateCalls.filter((u) => u.table === "template_broadcasts" && u.values.status === "completed");

  it("does NOT finalize a running broadcast that has zero recipient rows yet (the create-race guard)", async () => {
    // Regression: createBroadcast inserts the broadcast row before its recipient rows. A drain landing
    // in that gap used to see 0 pending recipients and mark the broadcast 'completed', after which the
    // running-only claim could never send its (later-inserted) rows — stranding them all as 'queued'.
    claimRows = [];
    runningBroadcasts = [{ id: "b1" }];
    totalCount = 0; // recipients not enqueued yet
    pendingCount = 0; // ...so nothing pending either — must NOT be read as "done"

    await drainBroadcasts();

    expect(completed()).toHaveLength(0);
  });

  it("finalizes a running broadcast once it has recipient rows and none are pending", async () => {
    claimRows = [];
    runningBroadcasts = [{ id: "b1" }];
    totalCount = 18; // recipients enqueued
    pendingCount = 0; // all settled (sent/failed/skipped)

    await drainBroadcasts();

    const done = completed();
    expect(done).toHaveLength(1);
    expect(done[0].eqVal).toBe("b1");
  });

  it("does NOT finalize while recipients are still pending", async () => {
    claimRows = [];
    runningBroadcasts = [{ id: "b1" }];
    totalCount = 18;
    pendingCount = 5; // still draining

    await drainBroadcasts();

    expect(completed()).toHaveLength(0);
  });
});

describe("drainUntilEmpty", () => {
  it("loops across non-empty batches and stops on the first empty one", async () => {
    // 2 then 1 then 0 — three claim calls, then it stops.
    batchQueue = [[row("1"), row("2")], [row("3")], []];

    const result = await drainUntilEmpty();

    expect(result.processed).toBe(3);
    expect(result.batches).toBe(3);
    expect(sendTemplateNotification).toHaveBeenCalledTimes(3);
    expect(rpcCalls.filter((c) => c.fn === "claim_broadcast_recipients")).toHaveLength(3);
  });

  it("stops at maxBatches even when batches keep returning rows (bounded loop)", async () => {
    // claimRows is non-empty and batchQueue is empty, so every claim returns a row — never drains.
    claimRows = [row("9")];

    const result = await drainUntilEmpty({ maxBatches: 3 });

    expect(result.batches).toBe(3);
    expect(result.processed).toBe(3);
    expect(rpcCalls.filter((c) => c.fn === "claim_broadcast_recipients")).toHaveLength(3);
  });
});
