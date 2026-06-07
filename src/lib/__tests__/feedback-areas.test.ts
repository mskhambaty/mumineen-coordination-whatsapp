import { describe, expect, it } from "vitest";

import { normalizeArea } from "@/lib/feedback/areas";

describe("normalizeArea", () => {
  it("passes through valid areas", () => {
    expect(normalizeArea("mawaid")).toBe("mawaid");
    expect(normalizeArea("parking_transport")).toBe("parking_transport");
    expect(normalizeArea("general")).toBe("general");
  });

  it("maps common LLM synonyms to a valid area", () => {
    expect(normalizeArea("food")).toBe("mawaid");
    expect(normalizeArea("Parking")).toBe("parking_transport");
    expect(normalizeArea("sound")).toBe("audio_video");
    expect(normalizeArea("hotel")).toBe("accommodation");
    expect(normalizeArea("wheelchair")).toBe("seating");
    expect(normalizeArea("crowd")).toBe("flow");
  });

  it("falls back to general for anything unknown (never drops feedback)", () => {
    expect(normalizeArea("facilities")).toBe("general");
    expect(normalizeArea("weather")).toBe("general");
    expect(normalizeArea("")).toBe("general");
    expect(normalizeArea(null)).toBe("general");
    expect(normalizeArea(42)).toBe("general");
  });
});
