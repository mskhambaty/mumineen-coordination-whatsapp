import { describe, expect, it } from "vitest";

import { pickFinalModel } from "@/lib/agent/run-agent";

const STD = "gpt-standard";
const HIGH = "gpt-high";

describe("pickFinalModel", () => {
  it("uses the high model when a Waaz Talaqi / Lisan tool was called", () => {
    expect(pickFinalModel([{ type: "function", function: { name: "answer_religious_questions" } }], STD, HIGH)).toBe(HIGH);
    expect(pickFinalModel([{ type: "function", function: { name: "get_lisan_word_meaning" } }], STD, HIGH)).toBe(HIGH);
    // Mixed: a religious tool anywhere in the round bumps the model.
    expect(
      pickFinalModel(
        [
          { type: "function", function: { name: "get_site_content_faq" } },
          { type: "function", function: { name: "answer_religious_questions" } },
        ],
        STD,
        HIGH,
      ),
    ).toBe(HIGH);
  });

  it("uses the standard model for other tools or no tools", () => {
    expect(pickFinalModel([{ type: "function", function: { name: "get_site_content_faq" } }], STD, HIGH)).toBe(STD);
    expect(pickFinalModel([{ type: "function", function: { name: "move_to_escalation" } }], STD, HIGH)).toBe(STD);
    expect(pickFinalModel([], STD, HIGH)).toBe(STD);
    expect(pickFinalModel(undefined, STD, HIGH)).toBe(STD);
  });
});
