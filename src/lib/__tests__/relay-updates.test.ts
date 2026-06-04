import { describe, expect, it } from "vitest";

import {
  RELAY_UPDATE_CATEGORIES,
  buildUpdateChunks,
  toFeedItem,
  validateRelayUpdateInput,
} from "@/lib/relay-updates/shared";

const valid = {
  date: "2026-06-10",
  title: "Shuttle schedule posted",
  body: "Shuttles run every 30 minutes from both hotels.",
  category: "travel",
};

describe("validateRelayUpdateInput", () => {
  it("accepts a valid input and defaults published to true, link/cta to null", () => {
    const r = validateRelayUpdateInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ ...valid, link: null, cta: null, published: true });
    }
  });

  it("accepts an http(s) link with a cta label", () => {
    const r = validateRelayUpdateInput({ ...valid, link: "https://www.chicagorelaycenter.com/parking", cta: "View your zone" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.link).toBe("https://www.chicagorelaycenter.com/parking");
      expect(r.value.cta).toBe("View your zone");
    }
  });

  it("rejects a non-http link and a cta without a link", () => {
    expect(validateRelayUpdateInput({ ...valid, link: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateRelayUpdateInput({ ...valid, cta: "View" }).ok).toBe(false);
  });

  it("accepts an explicit published=false", () => {
    const r = validateRelayUpdateInput({ ...valid, published: false });
    expect(r.ok && r.value.published).toBe(false);
  });

  it("rejects an unknown category", () => {
    const r = validateRelayUpdateInput({ ...valid, category: "general" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/category/i);
  });

  it("rejects a malformed date", () => {
    const r = validateRelayUpdateInput({ ...valid, date: "06/10/2026" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/date/i);
  });

  it("rejects a missing title and an overlong title", () => {
    expect(validateRelayUpdateInput({ ...valid, title: "  " }).ok).toBe(false);
    expect(validateRelayUpdateInput({ ...valid, title: "x".repeat(201) }).ok).toBe(false);
  });

  it("rejects a missing body and an overlong body", () => {
    expect(validateRelayUpdateInput({ ...valid, body: "" }).ok).toBe(false);
    expect(validateRelayUpdateInput({ ...valid, body: "x".repeat(1001) }).ok).toBe(false);
  });

  it("exposes exactly the four categories", () => {
    expect([...RELAY_UPDATE_CATEGORIES]).toEqual(["urgent", "schedule", "travel", "advisory"]);
  });
});

describe("toFeedItem", () => {
  it("maps a row to the static page schema with id, omitting unset link/cta", () => {
    expect(
      toFeedItem({ id: "u-1", date: "2026-06-10", title: "T", body: "B", category: "urgent", link: null, cta: null }),
    ).toEqual({ id: "u-1", date: "2026-06-10", title: "T", body: "B", category: "urgent" });
  });

  it("includes link and cta when set", () => {
    expect(
      toFeedItem({ id: "u-2", date: "2026-06-10", title: "T", body: "B", category: "travel", link: "https://x.test/p", cta: "Go" }),
    ).toEqual({ id: "u-2", date: "2026-06-10", title: "T", body: "B", category: "travel", link: "https://x.test/p", cta: "Go" });
  });

  it("trims a timestamp-style date to yyyy-mm-dd", () => {
    expect(toFeedItem({ id: "u-3", date: "2026-06-10T00:00:00", title: "T", body: "B", category: "urgent", link: null, cta: null }).date).toBe(
      "2026-06-10",
    );
  });
});

describe("leadership gate shapes", () => {
  // The route gate (requireLeadership) defers to isAdminOrLeadership; pin the shapes it must accept/reject.
  it("accepts admin and leadership, rejects everyone else", async () => {
    const { isAdminOrLeadership } = await import("@/lib/admin/access");
    expect(isAdminOrLeadership({ role: "admin" })).toBe(true);
    expect(isAdminOrLeadership({ global_role: "leadership_admin" })).toBe(true);
    expect(isAdminOrLeadership({ role: "committee", global_role: "pm" })).toBe(false);
    expect(isAdminOrLeadership(null)).toBe(false);
  });
});

describe("buildUpdateChunks", () => {
  it("renders one chunk per update with date, category label, title, and body", () => {
    const chunks = buildUpdateChunks([
      { date: "2026-06-10", title: "T1", body: "B1", category: "travel" },
      { date: "2026-06-09", title: "T2", body: "B2", category: "urgent" },
    ]);
    expect(chunks).toEqual([
      "[2026-06-10] Travel — T1: B1",
      "[2026-06-09] Urgent — T2: B2",
    ]);
  });
});
