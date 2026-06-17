import { describe, expect, it } from "vitest";

import {
  keywordMatch,
  meetsConfidence,
  SUGGESTION_CONFIDENCE_THRESHOLD,
} from "@/lib/escalation/issue-match";

const issue = (over: Partial<{ issue_number: number; title: string; description: string }>) => ({
  id: `iss-${over.issue_number ?? 1}`,
  issue_number: over.issue_number ?? 1,
  title: over.title ?? "",
  description: over.description ?? "",
  status: "open",
  priority: "medium",
  department: { name: "Transport" },
});

describe("meetsConfidence", () => {
  it("ranks high >= medium >= low", () => {
    expect(meetsConfidence("high", "high")).toBe(true);
    expect(meetsConfidence("medium", "high")).toBe(false);
    expect(meetsConfidence("low", "high")).toBe(false);
    expect(meetsConfidence("medium", "medium")).toBe(true);
    expect(meetsConfidence("high", "medium")).toBe(true);
    expect(meetsConfidence("low", "medium")).toBe(false);
  });

  it("defaults the surfaced-suggestion threshold to high", () => {
    expect(SUGGESTION_CONFIDENCE_THRESHOLD).toBe("high");
  });
});

describe("keywordMatch confidence", () => {
  it("never returns high confidence (keyword overlap is a weak signal)", () => {
    // Heavy overlap with the issue title so it scores well, but it's still only keyword evidence.
    const issues = [issue({ issue_number: 7, title: "Carpool offer Elmhurst masjid waaz rides transport" })];
    const matches = keywordMatch(issues, "carpool offer elmhurst masjid waaz rides transport", "");
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.confidence).not.toBe("high");
    }
    // And none survive the default "high" suggestion threshold.
    expect(matches.filter((m) => meetsConfidence(m.confidence, SUGGESTION_CONFIDENCE_THRESHOLD))).toHaveLength(0);
  });

  it("does not match unrelated escalations (parking pass vs carpool)", () => {
    const issues = [issue({ issue_number: 7, title: "Carpool offer from Elmhurst to masjid for waaz" })];
    const matches = keywordMatch(issues, "Requesting a parking pass for a guest", "");
    // No meaningful keyword overlap → no match at all.
    expect(matches).toHaveLength(0);
  });
});
