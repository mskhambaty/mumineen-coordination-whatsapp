import { describe, expect, it } from "vitest";

import { countUnreadInbound, groupRowsByPhoneChronologically } from "@/lib/admin/conversations";

describe("admin conversation helpers", () => {
  it("groups newest-first rows by phone and returns each thread chronologically", () => {
    const grouped = groupRowsByPhoneChronologically([
      { id: "new", phone_e164: "+13125550100", created_at: "2026-06-03T16:00:00.000Z" },
      { id: "other", phone_e164: "+13125550101", created_at: "2026-06-03T15:30:00.000Z" },
      { id: "old", phone_e164: "+13125550100", created_at: "2026-06-03T15:00:00.000Z" },
    ]);

    expect(grouped.get("+13125550100")?.map((row) => row.id)).toEqual(["old", "new"]);
    expect(grouped.get("+13125550101")?.map((row) => row.id)).toEqual(["other"]);
  });

  it("counts inbound messages after the most recent outbound reply", () => {
    expect(
      countUnreadInbound([
        { direction: "inbound" },
        { direction: "outbound" },
        { direction: "inbound" },
        { direction: "inbound" },
      ]),
    ).toBe(2);
  });
});
