import { beforeEach, describe, expect, it, vi } from "vitest";

// Flexible Supabase stub: records rpc() calls and serves configurable rows for the select/update
// chains used by suppressedPhones / listSuppressed / clearUndeliverable.
const h = vi.hoisted(() => {
  let selectData: unknown[] = [];
  let updateData: unknown[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let rpcError: { message: string } | null = null;

  const makeBuilder = () => {
    const builder: Record<string, unknown> = {
      _mode: "select",
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      update: () => {
        builder._mode = "update";
        return builder;
      },
      range: () => Promise.resolve({ data: selectData, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: builder._mode === "update" ? updateData : selectData, error: null }).then(resolve),
    };
    return builder;
  };

  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ error: rpcError });
    },
    from: () => makeBuilder(),
  };

  return {
    client,
    rpcCalls,
    setSelectData: (d: unknown[]) => {
      selectData = d;
    },
    setUpdateData: (d: unknown[]) => {
      updateData = d;
    },
    setRpcError: (e: { message: string } | null) => {
      rpcError = e;
    },
    reset: () => {
      selectData = [];
      updateData = [];
      rpcCalls.length = 0;
      rpcError = null;
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => h.client }));

import {
  clearUndeliverable,
  isUndeliverableErrorCode,
  listSuppressed,
  recordUndeliverable,
  suppressedPhones,
  UNDELIVERABLE_FAIL_THRESHOLD,
} from "@/lib/whatsapp/undeliverable";

beforeEach(() => h.reset());

describe("isUndeliverableErrorCode", () => {
  it("matches 131026 (not on WhatsApp / can't receive) only", () => {
    expect(isUndeliverableErrorCode(131026)).toBe(true);
    // Throttle / window / experiment codes are not the number's fault — must not suppress.
    expect(isUndeliverableErrorCode(131049)).toBe(false);
    expect(isUndeliverableErrorCode(131047)).toBe(false);
    expect(isUndeliverableErrorCode(null)).toBe(false);
    expect(isUndeliverableErrorCode(undefined)).toBe(false);
  });
});

describe("recordUndeliverable", () => {
  it("calls the atomic RPC with the normalized phone, code, and threshold for an undeliverable code", async () => {
    await recordUndeliverable("1 (312) 555-0001", 131026);
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]).toEqual({
      name: "record_whatsapp_undeliverable",
      args: { p_phone: "+13125550001", p_error_code: 131026, p_threshold: UNDELIVERABLE_FAIL_THRESHOLD },
    });
  });

  it("is a no-op for non-undeliverable codes and missing codes/phones", async () => {
    await recordUndeliverable("+13125550001", 131049); // throttled — not the number's fault
    await recordUndeliverable("+13125550001", null);
    await recordUndeliverable("", 131026);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("swallows RPC errors (best-effort side effect, never throws)", async () => {
    h.setRpcError({ message: "boom" });
    await expect(recordUndeliverable("+13125550001", 131026)).resolves.toBeUndefined();
  });
});

describe("suppressedPhones", () => {
  it("returns a normalized set of currently-suppressed numbers", async () => {
    h.setSelectData([{ phone_e164: "+13125550001" }, { phone_e164: "13125550002" }]);
    const set = await suppressedPhones();
    expect(set.has("+13125550001")).toBe(true);
    expect(set.has("+13125550002")).toBe(true); // normalized to leading +
    expect(set.size).toBe(2);
  });
});

describe("listSuppressed", () => {
  it("returns the suppressed rows", async () => {
    h.setSelectData([{ phone_e164: "+13125550001", fail_count: 2, last_error_code: 131026 }]);
    const rows = await listSuppressed();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phone_e164: "+13125550001", fail_count: 2 });
  });
});

describe("clearUndeliverable", () => {
  it("returns true when a suppressed row was cleared", async () => {
    h.setUpdateData([{ phone_e164: "+13125550001" }]);
    expect(await clearUndeliverable("+1 312 555 0001", "user-1")).toBe(true);
  });

  it("returns false when the number isn't on the list", async () => {
    h.setUpdateData([]);
    expect(await clearUndeliverable("+13125550009", null)).toBe(false);
  });
});
