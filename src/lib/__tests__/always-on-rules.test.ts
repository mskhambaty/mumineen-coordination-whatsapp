import { describe, expect, it } from "vitest";

import { ALWAYS_ON_RULES, RELIGIOUS_GUIDANCE_RULE } from "@/lib/agent/run-agent";

describe("ALWAYS_ON_RULES registry", () => {
  it("lists every always-on rule with name/label/text", () => {
    expect(ALWAYS_ON_RULES.length).toBeGreaterThanOrEqual(12);
    for (const rule of ALWAYS_ON_RULES) {
      expect(rule.name).toMatch(/^[A-Z_]+$/);
      expect(rule.label.length).toBeGreaterThan(0);
      expect(rule.text.length).toBeGreaterThan(0);
    }
  });

  it("includes the Waaz Talaqi rule with its exact text (single source of truth)", () => {
    const religious = ALWAYS_ON_RULES.find((r) => r.name === "RELIGIOUS_GUIDANCE_RULE");
    expect(religious?.text).toBe(RELIGIOUS_GUIDANCE_RULE);
  });
});
