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

  it("includes a Tool Routing rule that maps each question type to its tool", () => {
    const routing = ALWAYS_ON_RULES.find((r) => r.name === "TOOL_ROUTING_RULE");
    expect(routing).toBeDefined();
    for (const tool of [
      "get_site_content_faq",
      "answer_religious_questions",
      "get_lisan_word_meaning",
      "report_lost_item",
      "report_found_item",
    ]) {
      expect(routing?.text).toContain(tool);
    }
  });
});
