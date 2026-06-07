import { describe, expect, it } from "vitest";

import { extractStatusUpdates } from "@/lib/whatsapp/broadcast-status";

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
    expect(updates[0]).toEqual({ waMessageId: "wamid.A", status: "delivered", timestamp: 1700000000 });
    expect(updates[1].status).toBe("read");
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
