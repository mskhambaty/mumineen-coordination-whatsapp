import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "@/lib/agent/run-agent";
import {
  formatSenderProfileForPrompt,
  toPublicSenderProfile,
  type SenderProfile,
} from "@/lib/mumineen/sender-profile";

function profile(overrides: Partial<SenderProfile> = {}): SenderProfile {
  return {
    in_roster: true,
    registration_status: "submitted",
    member_count: 4,
    member: {
      full_name: "Mufaddal",
      age: 34,
      gender: "M",
      jamaat: "Chicago",
      city: "Naperville",
      local_mehman: "Mehman",
      category: null,
      title: null,
      not_attending: false,
      arrival_at: "2026-06-24T15:00:00Z",
      arrival_flight_no: "EK203",
      airport: "ORD",
      departure_at: "2026-07-02T09:00:00Z",
      rahat_seating: true,
      wheelchair: false,
      special_needs: "Diabetic — needs ground floor",
      wants_khidmat: true,
    },
    family: {
      acc_type: "hotel",
      hotel_name: "Hyatt Place",
      utaro_host_name: null,
      open_to_utaro: true,
      transport_mode: "rideshare",
      transport_detail: null,
    },
    ...overrides,
  };
}

describe("formatSenderProfileForPrompt", () => {
  it("includes registration, age, accommodation, transport, travel, and accessibility", () => {
    const text = formatSenderProfileForPrompt(profile());
    expect(text).toContain("Registration: submitted (family of 4)");
    expect(text).toContain("Age: 34");
    expect(text).toContain("Accommodation: Hotel — Hyatt Place");
    expect(text).toContain("Transport: rideshare");
    expect(text).toContain("Arrival: 2026-06-24 (EK203) at ORD");
    expect(text).toContain("Departure: 2026-07-02");
    expect(text).toContain("Accessibility: rahat seating");
    expect(text).toContain("Special needs: Diabetic — needs ground floor");
    expect(text).toContain("Interested in khidmat");
  });

  it("never leaks contact identifiers it isn't given", () => {
    const text = formatSenderProfileForPrompt(profile());
    expect(text).not.toMatch(/@/); // no email
    expect(text).not.toMatch(/\bITS\b/i);
  });

  it("returns empty string when the sender isn't a registered roster member", () => {
    expect(formatSenderProfileForPrompt(null)).toBe("");
    expect(formatSenderProfileForPrompt(undefined)).toBe("");
    expect(formatSenderProfileForPrompt(profile({ in_roster: false }))).toBe("");
  });
});

describe("toPublicSenderProfile", () => {
  it("strips age but keeps logistics fields", () => {
    const pub = toPublicSenderProfile(profile());
    expect(pub.member).not.toHaveProperty("age");
    expect(JSON.stringify(pub)).not.toContain("34");
    expect(pub.member?.full_name).toBe("Mufaddal");
    expect(pub.family?.hotel_name).toBe("Hyatt Place");
    expect(pub.registration_status).toBe("submitted");
  });

  it("handles a roster member with no family/member detail", () => {
    const pub = toPublicSenderProfile(profile({ member: null, family: null }));
    expect(pub.member).toBeNull();
    expect(pub.family).toBeNull();
  });
});

describe("buildSystemPrompt with sender profile", () => {
  it("appends profile lines after the Sender Context marker", () => {
    const prompt = buildSystemPrompt({
      basePrompt: "## Base",
      departmentSection: "",
      callerContext: undefined,
      phoneE164: "+15551234567",
      role: "visitor",
      senderProfile: profile(),
    });
    const senderIdx = prompt.indexOf("## Sender Context");
    expect(senderIdx).toBeGreaterThan(-1);
    expect(prompt.indexOf("Accommodation: Hotel — Hyatt Place")).toBeGreaterThan(senderIdx);
  });

  it("keeps the static prefix byte-identical when no profile is supplied", () => {
    const common = {
      basePrompt: "## Base",
      departmentSection: "",
      callerContext: undefined,
      phoneE164: "+15551234567",
      role: "visitor" as const,
    };
    const withProfile = buildSystemPrompt({ ...common, senderProfile: profile() });
    const withoutProfile = buildSystemPrompt({ ...common, senderProfile: null });
    const prefix = (p: string) => p.slice(0, p.indexOf("## Sender Context"));
    expect(prefix(withProfile)).toBe(prefix(withoutProfile));
    // The profile genuinely changes only the per-user tail.
    expect(withProfile).not.toBe(withoutProfile);
  });
});
