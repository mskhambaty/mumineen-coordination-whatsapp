import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => {
  let recip: unknown = null;
  const patches: Record<string, unknown>[] = [];
  const client = {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: recip, error: null }),
        update: (patch: Record<string, unknown>) => {
          patches.push(patch);
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return builder;
    },
  };
  return {
    client,
    patches,
    setRecip: (r: unknown) => {
      recip = r;
    },
    reset: () => {
      recip = null;
      patches.length = 0;
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => supabaseMock.client }));

const undeliverableMock = vi.hoisted(() => ({ recordUndeliverable: vi.fn() }));
vi.mock("@/lib/whatsapp/undeliverable", () => ({ recordUndeliverable: undeliverableMock.recordUndeliverable }));

import { applyBroadcastStatuses, extractStatusUpdates } from "@/lib/whatsapp/broadcast-status";

describe("extractStatusUpdates", () => {
  it("pulls status updates out of a Meta status webhook payload", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.A", status: "delivered", timestamp: "1700000000" },
                  { id: "wamid.B", status: "read", timestamp: "1700000050" },
                ],
              },
            },
          ],
        },
      ],
    };
    const updates = extractStatusUpdates(payload);
    expect(updates).toHaveLength(2);
    // Non-error statuses carry no errorDetail (exact-match guards that we don't add stray fields).
    expect(updates[0]).toEqual({ waMessageId: "wamid.A", status: "delivered", timestamp: 1700000000 });
    expect(updates[1].status).toBe("read");
    expect(updates[1].errorDetail).toBeUndefined();
  });

  it("captures Meta's error code + title (with a friendly hint) from a failed status", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.F",
                    status: "failed",
                    timestamp: "1700000100",
                    recipient_id: "15551234567",
                    errors: [
                      {
                        code: 131049,
                        title: "This message was not delivered to maintain healthy ecosystem engagement.",
                        message: "(#131049) ...",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const [update] = extractStatusUpdates(payload);
    expect(update.status).toBe("failed");
    expect(update.errorDetail).toBe(
      "131049: This message was not delivered to maintain healthy ecosystem engagement. (Meta engagement/frequency cap — recipient throttled)",
    );
    // The raw numeric code is surfaced separately so suppression logic can match it without parsing.
    expect(update.errorCode).toBe(131049);
    // Must never leak the recipient phone/id into the stored reason.
    expect(update.errorDetail).not.toContain("15551234567");
  });

  it("captures the 131026 (undeliverable) code from a failed status", () => {
    const payload = {
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.U", status: "failed", timestamp: "1700000300", errors: [{ code: 131026, title: "Message Undeliverable" }] }] } }] }],
    };
    const [update] = extractStatusUpdates(payload);
    expect(update.errorCode).toBe(131026);
  });

  it("leaves errorCode undefined for non-error statuses", () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.A", status: "delivered", timestamp: "1700000000" }] } }] }] };
    expect(extractStatusUpdates(payload)[0].errorCode).toBeUndefined();
  });

  it("falls back to error_data.details when title is missing and emits a bare code for unknown codes", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.G", status: "failed", timestamp: "1700000200", errors: [{ code: 999999, error_data: { details: "Some other reason" } }] },
                ],
              },
            },
          ],
        },
      ],
    };
    const [update] = extractStatusUpdates(payload);
    expect(update.errorDetail).toBe("999999: Some other reason");
  });

  it("returns [] for a message-only payload (no statuses)", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: "wamid.X" }] } }] }] };
    expect(extractStatusUpdates(payload)).toEqual([]);
  });

  it("returns [] for malformed input", () => {
    expect(extractStatusUpdates(null)).toEqual([]);
    expect(extractStatusUpdates({})).toEqual([]);
    expect(extractStatusUpdates({ entry: "nope" })).toEqual([]);
  });
});

describe("applyBroadcastStatuses", () => {
  beforeEach(() => {
    supabaseMock.reset();
    undeliverableMock.recordUndeliverable.mockClear();
  });

  it("records the number for suppression on a failed status, passing the recipient phone + Meta code", async () => {
    supabaseMock.setRecip({ id: "r1", send_status: "sent", phone_e164: "+13125550001" });
    await applyBroadcastStatuses([{ waMessageId: "wamid.U", status: "failed", timestamp: 1700000300, errorCode: 131026 }]);
    expect(undeliverableMock.recordUndeliverable).toHaveBeenCalledWith("+13125550001", 131026);
  });

  it("does not touch the suppression list for a successful (delivered) status", async () => {
    supabaseMock.setRecip({ id: "r2", send_status: "sent", phone_e164: "+13125550002" });
    await applyBroadcastStatuses([{ waMessageId: "wamid.D", status: "delivered", timestamp: 1700000000 }]);
    expect(undeliverableMock.recordUndeliverable).not.toHaveBeenCalled();
  });

  it("does not re-count a redelivered failed webhook (row already 'failed')", async () => {
    // Meta can redeliver a status webhook; counting the same failure twice would suppress a number
    // from a single real failure. Only the first transition into 'failed' counts.
    supabaseMock.setRecip({ id: "r3", send_status: "failed", phone_e164: "+13125550003" });
    await applyBroadcastStatuses([{ waMessageId: "wamid.U", status: "failed", timestamp: 1700000300, errorCode: 131026 }]);
    expect(undeliverableMock.recordUndeliverable).not.toHaveBeenCalled();
  });

  it("writes error_detail when a failed status carries a Meta reason (regression)", async () => {
    supabaseMock.setRecip({ id: "r1", send_status: "sent" });
    const applied = await applyBroadcastStatuses([{ waMessageId: "wamid.F", status: "failed", timestamp: 1700000100, errorDetail: "131026: Undeliverable" }]);
    expect(applied).toBe(1);
    expect(supabaseMock.patches).toHaveLength(1);
    expect(supabaseMock.patches[0]).toMatchObject({ send_status: "failed", error_detail: "131026: Undeliverable" });
  });

  it("does not set error_detail for non-failed statuses", async () => {
    supabaseMock.setRecip({ id: "r2", send_status: "sent" });
    await applyBroadcastStatuses([{ waMessageId: "wamid.D", status: "delivered", timestamp: 1700000000 }]);
    expect(supabaseMock.patches[0]).toMatchObject({ send_status: "delivered" });
    expect(supabaseMock.patches[0].error_detail).toBeUndefined();
  });

  it("does not clobber with null when a failed status has no Meta reason", async () => {
    supabaseMock.setRecip({ id: "r3", send_status: "sent" });
    await applyBroadcastStatuses([{ waMessageId: "wamid.F2", status: "failed", timestamp: 1700000100 }]);
    expect(supabaseMock.patches[0]).toMatchObject({ send_status: "failed" });
    expect(supabaseMock.patches[0].error_detail).toBeUndefined();
  });
});
